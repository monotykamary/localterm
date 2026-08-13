#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static void record_pid(void) {
  const char *pid_file = getenv("LOCALTERM_FIXTURE_PID_FILE");
  if (pid_file == NULL) return;
  FILE *file = fopen(pid_file, "w");
  if (file == NULL) return;
  fprintf(file, "%d\n", getpid());
  fclose(file);
}

int main(int argument_count, char **argument_values) {
  const char *service = NULL;
  for (int index = 1; index + 1 < argument_count; index += 1) {
    if (strcmp(argument_values[index], "-s") == 0) service = argument_values[index + 1];
  }
  if (service == NULL || strcmp(service, "localterm:missing") == 0) return 44;
  if (strcmp(service, "localterm:oversize") == 0) {
    for (int index = 0; index < 8193; index += 1) putchar('x');
    putchar('\n');
    return 0;
  }
  if (strcmp(service, "localterm:cr") == 0) {
    fputs("synthetic-cr\r\n", stdout);
    return 0;
  }
  if (strcmp(service, "localterm:nul") == 0) {
    const char value[] = {'a', 'b', 'c', '\0', 'd', 'e', 'f', '\n'};
    fwrite(value, 1, sizeof(value), stdout);
    return 0;
  }
  if (strcmp(service, "localterm:hang") == 0 || strcmp(service, "localterm:ignoreterm") == 0) {
    if (strcmp(service, "localterm:ignoreterm") == 0) signal(SIGTERM, SIG_IGN);
    record_pid();
    for (;;) pause();
  }
  if (strncmp(service, "localterm:slow", 14) == 0) usleep(100000);
  printf("synthetic-%s\n", service + strlen("localterm:"));
  return 0;
}
