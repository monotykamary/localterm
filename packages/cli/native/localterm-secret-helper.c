#include <ctype.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <poll.h>
#include <signal.h>
#include <spawn.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stddef.h>
#include <stdlib.h>
#include <string.h>
#include <sysexits.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

extern char **environ;

#ifndef LOCALTERM_SECURITY_PATH
#define LOCALTERM_SECURITY_PATH "/usr/bin/security"
#endif
#ifndef LOCALTERM_BATCH_TIMEOUT_MS
#define LOCALTERM_BATCH_TIMEOUT_MS 5000
#endif
#ifndef LOCALTERM_TERM_GRACE_MS
#define LOCALTERM_TERM_GRACE_MS 250
#endif
#ifndef LOCALTERM_KILL_REAP_MS
#define LOCALTERM_KILL_REAP_MS 250
#endif

#define KEYCHAIN_ACCOUNT "localterm"
#define SERVICE_PREFIX "localterm:"
#define MAX_MAPPINGS 32
#define MAX_NAME_LENGTH 64
#define MAX_ENV_LENGTH 64
#define MAX_VALUE_LENGTH 8192
#define WAIT_SLICE_MS 10

struct mapping {
  const char *environment_name;
  const char *secret_name;
  pid_t process_id;
  int read_fd;
  int status;
  size_t value_length;
  bool overflow;
  bool embedded_nul;
  char value[MAX_VALUE_LENGTH + 2];
};

static volatile sig_atomic_t received_signal = 0;

static void handle_signal(int signal_number) {
  received_signal = signal_number;
}

static bool valid_secret_name(const char *value) {
  const size_t length = strlen(value);
  if (length == 0 || length > MAX_NAME_LENGTH || !isalnum((unsigned char)value[0])) return false;
  for (size_t index = 1; index < length; index += 1) {
    const unsigned char character = (unsigned char)value[index];
    if (!isalnum(character) && character != '_' && character != '-') return false;
  }
  return true;
}

static bool valid_environment_name(const char *value) {
  const size_t length = strlen(value);
  if (length == 0 || length > MAX_ENV_LENGTH || (value[0] != '_' && !isupper((unsigned char)value[0]))) {
    return false;
  }
  for (size_t index = 1; index < length; index += 1) {
    const unsigned char character = (unsigned char)value[index];
    if (character != '_' && !isupper(character) && !isdigit(character)) return false;
  }
  return true;
}

static int64_t monotonic_milliseconds(void) {
  struct timespec now;
  if (clock_gettime(CLOCK_MONOTONIC, &now) != 0) return -1;
  return (int64_t)now.tv_sec * 1000 + now.tv_nsec / 1000000;
}

static int remaining_milliseconds(int64_t deadline) {
  const int64_t now = monotonic_milliseconds();
  if (now < 0 || now >= deadline) return 0;
  const int64_t remaining = deadline - now;
  return remaining > INT_MAX ? INT_MAX : (int)remaining;
}

static void wipe_mappings(struct mapping *mappings, size_t count) {
  for (size_t index = 0; index < count; index += 1) {
    volatile unsigned char *value = (volatile unsigned char *)mappings[index].value;
    for (size_t byte = 0; byte < sizeof(mappings[index].value); byte += 1) value[byte] = 0;
    mappings[index].value_length = 0;
  }
}

static void close_mapping_fds(struct mapping *mappings, size_t count) {
  for (size_t index = 0; index < count; index += 1) {
    if (mappings[index].read_fd >= 0) {
      close(mappings[index].read_fd);
      mappings[index].read_fd = -1;
    }
  }
}

static bool reap_available(struct mapping *mappings, size_t count) {
  bool any_running = false;
  for (size_t index = 0; index < count; index += 1) {
    if (mappings[index].process_id <= 0) continue;
    int status = 0;
    const pid_t result = waitpid(mappings[index].process_id, &status, WNOHANG);
    if (result == mappings[index].process_id || (result < 0 && errno == ECHILD)) {
      mappings[index].status = status;
      mappings[index].process_id = -1;
    } else {
      any_running = true;
    }
  }
  return any_running;
}

static void bounded_reap(struct mapping *mappings, size_t count, int milliseconds) {
  const int64_t now = monotonic_milliseconds();
  const int64_t deadline = now < 0 ? 0 : now + milliseconds;
  while (reap_available(mappings, count) && remaining_milliseconds(deadline) > 0) {
    const int remaining = remaining_milliseconds(deadline);
    (void)poll(NULL, 0, remaining < WAIT_SLICE_MS ? remaining : WAIT_SLICE_MS);
  }
}

static void terminate_and_reap(struct mapping *mappings, size_t count) {
  close_mapping_fds(mappings, count);
  for (size_t index = 0; index < count; index += 1) {
    if (mappings[index].process_id > 0) (void)kill(mappings[index].process_id, SIGTERM);
  }
  bounded_reap(mappings, count, LOCALTERM_TERM_GRACE_MS);
  for (size_t index = 0; index < count; index += 1) {
    if (mappings[index].process_id > 0) (void)kill(mappings[index].process_id, SIGKILL);
  }
  bounded_reap(mappings, count, LOCALTERM_KILL_REAP_MS);
}

static int move_above_stdio(int descriptor) {
  if (descriptor > STDERR_FILENO) return descriptor;
  const int moved = fcntl(descriptor, F_DUPFD_CLOEXEC, STDERR_FILENO + 1);
  if (moved >= 0) close(descriptor);
  return moved;
}

static int spawn_lookup(struct mapping *mapping) {
  int output_pipe[2];
  if (pipe(output_pipe) != 0) return -1;
  output_pipe[0] = move_above_stdio(output_pipe[0]);
  if (output_pipe[0] < 0) {
    close(output_pipe[1]);
    return -1;
  }
  output_pipe[1] = move_above_stdio(output_pipe[1]);
  if (output_pipe[1] < 0) {
    close(output_pipe[0]);
    return -1;
  }

  int null_fd = open("/dev/null", O_WRONLY);
  if (null_fd >= 0) null_fd = move_above_stdio(null_fd);
  posix_spawn_file_actions_t actions;
  if (null_fd < 0 || posix_spawn_file_actions_init(&actions) != 0) {
    if (null_fd >= 0) close(null_fd);
    close(output_pipe[0]);
    close(output_pipe[1]);
    return -1;
  }
  if (posix_spawn_file_actions_adddup2(&actions, output_pipe[1], STDOUT_FILENO) != 0 ||
      posix_spawn_file_actions_adddup2(&actions, null_fd, STDERR_FILENO) != 0 ||
      posix_spawn_file_actions_addclose(&actions, output_pipe[0]) != 0 ||
      posix_spawn_file_actions_addclose(&actions, output_pipe[1]) != 0 ||
      posix_spawn_file_actions_addclose(&actions, null_fd) != 0) {
    close(null_fd);
    posix_spawn_file_actions_destroy(&actions);
    close(output_pipe[0]);
    close(output_pipe[1]);
    return -1;
  }

  char service[MAX_NAME_LENGTH + sizeof(SERVICE_PREFIX)];
  const int service_length = snprintf(service, sizeof(service), "%s%s", SERVICE_PREFIX, mapping->secret_name);
  if (service_length < 0 || (size_t)service_length >= sizeof(service)) {
    close(null_fd);
    posix_spawn_file_actions_destroy(&actions);
    close(output_pipe[0]);
    close(output_pipe[1]);
    return -1;
  }
  char *arguments[] = {
    (char *)LOCALTERM_SECURITY_PATH, "find-generic-password", "-s", service,
    "-a", KEYCHAIN_ACCOUNT, "-w", NULL,
  };
  const int result = posix_spawn(&mapping->process_id, LOCALTERM_SECURITY_PATH, &actions, NULL, arguments, environ);
  close(null_fd);
  posix_spawn_file_actions_destroy(&actions);
  close(output_pipe[1]);
  if (result != 0) {
    close(output_pipe[0]);
    mapping->process_id = -1;
    return -1;
  }
  mapping->read_fd = output_pipe[0];
  const int flags = fcntl(mapping->read_fd, F_GETFL);
  if (flags < 0 || fcntl(mapping->read_fd, F_SETFL, flags | O_NONBLOCK) < 0) return -1;
  return 0;
}

static int collect_outputs(struct mapping *mappings, size_t count, int64_t deadline) {
  struct pollfd poll_fds[MAX_MAPPINGS];
  size_t open_count = count;
  for (size_t index = 0; index < count; index += 1) {
    poll_fds[index].fd = mappings[index].read_fd;
    poll_fds[index].events = POLLIN | POLLHUP;
    poll_fds[index].revents = 0;
  }

  while (open_count > 0) {
    if (received_signal != 0) return -1;
    const int remaining = remaining_milliseconds(deadline);
    if (remaining == 0) return -1;
    const int result = poll(poll_fds, (nfds_t)count, remaining);
    if (result == 0) return -1;
    if (result < 0) {
      if (errno == EINTR) continue;
      return -1;
    }
    for (size_t index = 0; index < count; index += 1) {
      if (poll_fds[index].fd < 0 || poll_fds[index].revents == 0) continue;
      char chunk[1024];
      while (true) {
        const ssize_t bytes_read = read(poll_fds[index].fd, chunk, sizeof(chunk));
        if (bytes_read > 0) {
          if (memchr(chunk, '\0', (size_t)bytes_read) != NULL) mappings[index].embedded_nul = true;
          const size_t available = sizeof(mappings[index].value) - mappings[index].value_length;
          const size_t copied = (size_t)bytes_read < available ? (size_t)bytes_read : available;
          if (copied > 0) {
            memcpy(mappings[index].value + mappings[index].value_length, chunk, copied);
            mappings[index].value_length += copied;
          }
          if (copied < (size_t)bytes_read) mappings[index].overflow = true;
          memset(chunk, 0, sizeof(chunk));
          if (received_signal != 0) return -1;
          continue;
        }
        memset(chunk, 0, sizeof(chunk));
        if (bytes_read < 0 && errno == EINTR) {
          if (received_signal != 0) return -1;
          continue;
        }
        if (bytes_read < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) break;
        close(poll_fds[index].fd);
        mappings[index].read_fd = -1;
        poll_fds[index].fd = -1;
        open_count -= 1;
        break;
      }
      poll_fds[index].revents = 0;
    }
  }
  return 0;
}

static int wait_for_children(struct mapping *mappings, size_t count, int64_t deadline) {
  while (reap_available(mappings, count)) {
    if (received_signal != 0 || remaining_milliseconds(deadline) == 0) return -1;
    const int remaining = remaining_milliseconds(deadline);
    (void)poll(NULL, 0, remaining < WAIT_SLICE_MS ? remaining : WAIT_SLICE_MS);
  }
  return 0;
}

int main(int argument_count, char **argument_values) {
  int result_code = EX_OSERR;
  int delimiter_index = -1;
  for (int index = 1; index < argument_count; index += 1) {
    if (strcmp(argument_values[index], "--") == 0) {
      delimiter_index = index;
      break;
    }
  }
  if (delimiter_index < 1 || delimiter_index + 1 >= argument_count || (delimiter_index - 1) % 2 != 0) return EX_USAGE;
  const size_t mapping_count = (size_t)(delimiter_index - 1) / 2;
  if (mapping_count > MAX_MAPPINGS) return EX_USAGE;

  struct mapping mappings[MAX_MAPPINGS] = {0};
  for (size_t index = 0; index < MAX_MAPPINGS; index += 1) {
    mappings[index].process_id = -1;
    mappings[index].read_fd = -1;
  }
  for (size_t index = 0; index < mapping_count; index += 1) {
    mappings[index].environment_name = argument_values[1 + (int)index * 2];
    mappings[index].secret_name = argument_values[2 + (int)index * 2];
    if (!valid_environment_name(mappings[index].environment_name) || !valid_secret_name(mappings[index].secret_name)) {
      result_code = EX_USAGE;
      goto done;
    }
  }

  const int handled_signals[] = {SIGINT, SIGHUP, SIGTERM};
  struct sigaction action = {0};
  action.sa_handler = handle_signal;
  sigemptyset(&action.sa_mask);
  for (size_t index = 0; index < sizeof(handled_signals) / sizeof(handled_signals[0]); index += 1) {
    if (sigaction(handled_signals[index], &action, NULL) != 0) goto done;
  }

  const int64_t started = monotonic_milliseconds();
  if (started < 0) goto done;
  const int64_t deadline = started + LOCALTERM_BATCH_TIMEOUT_MS;
  for (size_t index = 0; index < mapping_count; index += 1) {
    if (received_signal != 0 || remaining_milliseconds(deadline) == 0 || spawn_lookup(&mappings[index]) != 0) goto terminate;
  }
  if (collect_outputs(mappings, mapping_count, deadline) != 0 ||
      wait_for_children(mappings, mapping_count, deadline) != 0) goto terminate;

  for (size_t index = 0; index < mapping_count; index += 1) {
    if (mappings[index].value_length > 0 && mappings[index].value[mappings[index].value_length - 1] == '\n') {
      mappings[index].value_length -= 1;
    }
    if (mappings[index].value_length > MAX_VALUE_LENGTH) mappings[index].overflow = true;
    if (!mappings[index].overflow) mappings[index].value[mappings[index].value_length] = '\0';
    if (WIFEXITED(mappings[index].status) && WEXITSTATUS(mappings[index].status) == 0 &&
        !mappings[index].overflow && !mappings[index].embedded_nul && mappings[index].value_length > 0) {
      if (setenv(mappings[index].environment_name, mappings[index].value, 1) != 0) goto done;
    }
  }
  wipe_mappings(mappings, mapping_count);
  execv(argument_values[delimiter_index + 1], &argument_values[delimiter_index + 1]);
  return errno == ENOENT ? 127 : 126;

terminate:
  result_code = received_signal == 0 ? EX_OSERR : 128 + received_signal;
  terminate_and_reap(mappings, mapping_count);
  if (received_signal != 0) result_code = 128 + received_signal;
done:
  close_mapping_fds(mappings, mapping_count);
  wipe_mappings(mappings, mapping_count);
  return result_code;
}
