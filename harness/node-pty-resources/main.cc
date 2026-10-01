#include <cassert>
#include <cerrno>
#include <cstdio>
#include <cstring>
#include <map>
#include <set>
#include <string>
#include <vector>

namespace simulated {
constexpr int STDIN_FILENO = 0, STDOUT_FILENO = 1, STDERR_FILENO = 2;
constexpr int O_RDWR = 2, O_NOCTTY = 4, TCSANOW = 0;
constexpr int TIOCPTYGNAME = 1, TIOCSWINSZ = 2;
constexpr int POSIX_SPAWN_CLOEXEC_DEFAULT = 1, POSIX_SPAWN_SETSIGDEF = 2;
constexpr int POSIX_SPAWN_SETSIGMASK = 4, POSIX_SPAWN_SETSID = 8;
struct termios {};
struct winsize {};
struct posix_spawn_file_actions_t { std::set<int> targets; };
struct posix_spawnattr_t {};
struct sigset_t {};
using pid_t = int;
std::map<int, std::string> descriptors;
int step, fail_at, actions, attrs, ptys, attempts;
bool interrupt_once;

bool fail() { return ++step == fail_at; }
int allocate(const std::string& kind) {
  if (fail()) { errno = ENXIO; return -1; }
  int fd = 0;
  while (descriptors.count(fd)) ++fd;
  descriptors[fd] = kind;
  return fd;
}
int close(int fd) {
  assert(descriptors.erase(fd) == 1);
  // Cleanup must not overwrite the error returned by a failed allocation.
  errno = EBADF;
  return 0;
}
int open(const char* name, int) { return allocate(name); }
int posix_openpt(int) { ++ptys; return allocate("master"); }
int grantpt(int) { if (fail()) { errno = ENXIO; return -1; } return 0; }
int unlockpt(int fd) { return grantpt(fd); }
int ioctl(int, int request, void* out) {
  if (fail()) { errno = ENXIO; return -1; }
  if (request == TIOCPTYGNAME) std::strcpy(static_cast<char*>(out), "slave");
  return 0;
}
int ioctl(int fd, int, const winsize*) { return grantpt(fd); }
int tcsetattr(int fd, int, const termios*) { return grantpt(fd); }
int posix_spawn_file_actions_init(posix_spawn_file_actions_t*) {
  if (fail()) return EIO;
  ++actions;
  return 0;
}
int posix_spawn_file_actions_destroy(posix_spawn_file_actions_t*) { assert(--actions == 0); return 0; }
int posix_spawnattr_init(posix_spawnattr_t*) {
  if (fail()) return EIO;
  ++attrs;
  return 0;
}
int posix_spawnattr_destroy(posix_spawnattr_t*) { assert(--attrs == 0); return 0; }
int posix_spawn_file_actions_adddup2(posix_spawn_file_actions_t* acts, int fd, int target) {
  if (fail()) return EIO;
  assert(descriptors.at(fd) == "slave" && fd > STDERR_FILENO);
  acts->targets.insert(target);
  return 0;
}
int posix_spawn_file_actions_addclose(posix_spawn_file_actions_t*, int fd) {
  assert(descriptors.count(fd));
  return fail() ? EIO : 0;
}
int posix_spawnattr_setflags(posix_spawnattr_t*, int) { return fail() ? EIO : 0; }
int sigfillset(sigset_t*) { return 0; }
int sigemptyset(sigset_t*) { return 0; }
int posix_spawnattr_setsigdefault(posix_spawnattr_t*, const sigset_t*) { return fail() ? EIO : 0; }
int posix_spawnattr_setsigmask(posix_spawnattr_t*, const sigset_t*) { return fail() ? EIO : 0; }
int posix_spawn(pid_t* pid, const char*, const posix_spawn_file_actions_t* acts,
                const posix_spawnattr_t*, char**, char**) {
  ++attempts;
  if (interrupt_once) { interrupt_once = false; return EINTR; }
  if (fail()) return EIO;
  assert(acts->targets == std::set<int>({STDIN_FILENO, STDOUT_FILENO, STDERR_FILENO}));
  *pid = 1234;
  return 0;
}

#include "darwin-spawn.h"

int run(int mask, int failure, bool interrupted = false, bool options = true) {
  descriptors.clear();
  for (int fd = 0; fd < 3; ++fd) if (mask & (1 << fd)) descriptors[fd] = "stdio";
  const auto before = descriptors;
  step = actions = attrs = ptys = attempts = 0;
  fail_at = failure;
  interrupt_once = interrupted;
  int master = 999, pid = 999, error = 999;
  termios term;
  winsize size;
  char executable[] = "helper";
  char* argv[] = {executable, nullptr};
  pty_posix_spawn(argv, nullptr, options ? &term : nullptr, options ? &size : nullptr,
                  &master, &pid, &error);
  assert(actions == 0 && attrs == 0);
  assert(ptys <= 1);
  if (failure == 0) {
    assert(error == 0 && pid == 1234);
    assert(descriptors.at(master) == "master");
    close(master);
    assert(attempts == (interrupted ? 2 : 1));
  } else {
    assert(error == ENXIO || error == EIO);
    assert(master == -1 && pid == -1);
  }
  assert(descriptors == before);
  return step;
}
}

int main() {
  int cases = 0;
  for (int mask = 0; mask < 8; ++mask) {
    int steps = simulated::run(mask, 0);
    ++cases;
    for (int failure = 1; failure <= steps; ++failure) {
      simulated::run(mask, failure);
      ++cases;
    }
    simulated::run(mask, 0, true);
    simulated::run(mask, 0, false, false);
    cases += 2;
  }
  for (int iteration = 0; iteration < 1024; ++iteration) simulated::run(7, 0);
  // The same owner is used by the macOS exit watcher for its kqueue.
  simulated::descriptors.clear();
  simulated::fail_at = 0;
  {
    simulated::PtyScopedFd kqueue_fd(simulated::allocate("kqueue"));
    assert(simulated::descriptors.size() == 1);
  }
  assert(simulated::descriptors.empty());
  std::printf("%d fault-injection cases and 1024 spawn/exit cycles: no leaked descriptors\n", cases);
}
