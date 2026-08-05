#include <errno.h>
#include <signal.h>
#include <spawn.h>
#include <sysexits.h>
#include <sys/wait.h>
#include <unistd.h>

extern char **environ;

#define EXIT_SIGNAL_OFFSET 128
#define MINIMUM_ARGUMENT_COUNT 2

static volatile sig_atomic_t child_process_id = -1;

static void forward_signal(int signal_number) {
  const pid_t process_id = child_process_id;
  if (process_id > 0) {
    kill(process_id, signal_number);
  }
}

static int install_signal_handler(int signal_number) {
  struct sigaction action = {0};
  action.sa_handler = forward_signal;
  sigemptyset(&action.sa_mask);
  return sigaction(signal_number, &action, NULL);
}

int main(int argument_count, char **argument_values) {
  if (argument_count < MINIMUM_ARGUMENT_COUNT) {
    return EX_USAGE;
  }

  const int forwarded_signals[] = {SIGINT, SIGHUP, SIGTERM};
  const size_t signal_count = sizeof(forwarded_signals) / sizeof(forwarded_signals[0]);
  for (size_t signal_index = 0; signal_index < signal_count; signal_index += 1) {
    if (install_signal_handler(forwarded_signals[signal_index]) != 0) {
      return EX_OSERR;
    }
  }

  pid_t process_id = -1;
  const int spawn_result = posix_spawn(
    &process_id,
    argument_values[1],
    NULL,
    NULL,
    &argument_values[1],
    environ
  );
  if (spawn_result != 0) {
    return EX_OSERR;
  }
  child_process_id = process_id;

  int process_status = 0;
  while (waitpid(process_id, &process_status, 0) == -1) {
    if (errno != EINTR) {
      return EX_OSERR;
    }
  }
  child_process_id = -1;

  if (WIFEXITED(process_status)) {
    return WEXITSTATUS(process_status);
  }
  if (WIFSIGNALED(process_status)) {
    return EXIT_SIGNAL_OFFSET + WTERMSIG(process_status);
  }
  return EX_OSERR;
}
