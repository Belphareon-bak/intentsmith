/* Private CPU proposal. Never execute before ROOT source review.
 * linux-bwrap-private-loopback-v1; x86_64 only; no host/plain-spawn fallback.
 * Trusted parent supplies host namespace IDs before bwrap and pins the complete
 * launcher/tool/runtime/oracle mount closure. Project code never reaches setup.
 */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <limits.h>
#include <linux/audit.h>
#include <linux/capability.h>
#include <linux/filter.h>
#include <linux/landlock.h>
#include <linux/memfd.h>
#include <linux/nsfs.h>
#include <linux/seccomp.h>
#include <netinet/in.h>
#include <sched.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/prctl.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/sysmacros.h>
#include <sys/types.h>
#include <sys/utsname.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>
#include <signal.h>

#if !defined(__x86_64__) || defined(__ILP32__)
#error "private HTTP profile requires Linux x86_64 LP64"
#endif

#define PROFILE "linux-bwrap-private-loopback-v1"
#define SETUP_CAPS ((UINT64_C(1) << CAP_SETPCAP) | (UINT64_C(1) << CAP_NET_ADMIN) | (UINT64_C(1) << CAP_SYS_ADMIN))
#define MAX_CHILD_ARGS 64
#define MAX_CHILD_ARG_BYTES 65536
static char *const trusted_env[] = {
    "PATH=/usr/bin:/usr/sbin", "LANG=C.UTF-8", "TZ=UTC", "HOME=/tmp", NULL
};

/* Same text/semantics as canonical acc4a918 Python proof. No trailing newline.
 * Only the four numeric %u port slots are variable; never project/model text.
 */
static const char nft_template[] =
    "table inet intentsmith_m2_probe {\n"
    " chain input { type filter hook input priority 0; policy drop;\n"
    "  iifname \"lo\" ip saddr 127.0.0.1 ip daddr 127.0.0.1 tcp dport %u ct state { new, established } accept\n"
    "  iifname \"lo\" ip saddr 127.0.0.1 ip daddr 127.0.0.1 tcp sport %u ct state established ct direction reply accept\n"
    " }\n"
    " chain output { type filter hook output priority 0; policy drop;\n"
    "  oifname \"lo\" ip saddr 127.0.0.1 ip daddr 127.0.0.1 tcp dport %u ct state { new, established } accept\n"
    "  oifname \"lo\" ip saddr 127.0.0.1 ip daddr 127.0.0.1 tcp sport %u ct state established ct direction reply accept\n"
    " }\n"
    "}";

/* Literal canonical 39-row x86_64 cBPF. Export the actual ELF section bytes
 * as seccomp-program.bin; sizeof(sock_filter)=8 and target is little endian.
 * IP is enforced by nft; seccomp only filters architecture/syscalls/scalars.
 */
static const struct sock_filter seccomp_program[]
    __attribute__((section(".m2_seccomp"), used, aligned(4))) = {
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch)),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, AUDIT_ARCH_X86_64, 1, 0),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS),
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),
    BPF_JUMP(BPF_JMP | BPF_JGE | BPF_K, 0x40000000U, 0, 1),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_socket, 17, 0),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_clone, 26, 0),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_socketpair, 28, 0),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_ptrace, 27, 0),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_pivot_root, 26, 0),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_mount, 25, 0),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_umount2, 24, 0),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_add_key, 23, 0),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_request_key, 22, 0),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_keyctl, 21, 0),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_unshare, 20, 0),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_setns, 19, 0),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_process_vm_writev, 18, 0),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_io_uring_setup, 17, 0),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_io_uring_enter, 16, 0),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_io_uring_register, 15, 0),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_clone3, 13, 0),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, AF_INET, 1, 0),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EACCES),
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[1])),
    BPF_STMT(BPF_ALU | BPF_AND | BPF_K, (uint32_t)~(SOCK_NONBLOCK | SOCK_CLOEXEC)),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SOCK_STREAM, 1, 0),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EACCES),
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[2])),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, 0, 5, 0),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, IPPROTO_TCP, 4, 3),
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
    BPF_JUMP(BPF_JMP | BPF_JSET | BPF_K, 0x7e020000U, 1, 2),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | ENOSYS),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EACCES),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
};
_Static_assert(sizeof(struct sock_filter) == 8, "unexpected cBPF layout");
_Static_assert(sizeof(seccomp_program) / sizeof(seccomp_program[0]) == 39, "canonical rows");

static void fail(const char *stage) {
    fprintf(stderr, "M2_PRIVATE_HTTP_FAIL stage=%s errno=%d\n", stage, errno);
    _exit(125);
}
static void check(int ok, const char *stage) { if (!ok) fail(stage); }

static uint64_t read_status(const char *key, int hex) {
    FILE *file = fopen("/proc/self/status", "re");
    check(file != NULL, "status-open");
    char line[256], value[128]; uint64_t result = 0; int found = 0;
    while (fgets(line, sizeof(line), file)) {
        char *colon = strchr(line, ':');
        if (!colon) continue;
        *colon = 0;
        if (strcmp(line, key)) continue;
        check(sscanf(colon + 1, "%127s", value) == 1, "status-value");
        char *end = NULL; errno = 0; result = strtoull(value, &end, hex ? 16 : 10);
        check(errno == 0 && end && *end == 0, "status-parse");
        found = 1; break;
    }
    check(fclose(file) == 0 && found, "status-close-field");
    return result;
}
static void require_caps(uint64_t expected) {
    const char *fields[] = {"CapEff", "CapPrm", "CapInh", "CapAmb", "CapBnd"};
    for (size_t i = 0; i < sizeof(fields) / sizeof(fields[0]); ++i)
        check(read_status(fields[i], 1) == expected, "exact-capability-sets");
}
static void ns_link(const char *kind, char *out, size_t size) {
    char path[64]; int n = snprintf(path, sizeof(path), "/proc/self/ns/%s", kind);
    check(n > 0 && (size_t)n < sizeof(path), "namespace-path");
    ssize_t used = readlink(path, out, size - 1);
    check(used > 0 && (size_t)used < size - 1, "namespace-link");
    out[used] = 0;
}
static int valid_ns_arg(const char *text, const char *prefix) {
    size_t n = strlen(prefix);
    if (strncmp(text, prefix, n)) return 0;
    const char *p = text + n; if (*p < '1' || *p > '9') return 0;
    while (*p >= '0' && *p <= '9') ++p;
    return *p == ']' && p[1] == 0 && strlen(text) < 64;
}
static void close_nonstdio(void) {
    check(syscall(__NR_close_range, 3U, UINT_MAX, 0U) == 0, "close-nonstdio");
}
static void require_stdio(void) {
    for (int fd = 0; fd <= 2; ++fd) {
        struct stat s; check(fstat(fd, &s) == 0, "stdio-present");
        char path[32], target[128];
        int n = snprintf(path, sizeof(path), "/proc/self/fd/%d", fd);
        check(n > 0 && (size_t)n < sizeof(path), "stdio-path");
        ssize_t used = readlink(path, target, sizeof(target) - 1);
        check(used > 0 && (size_t)used < sizeof(target) - 1, "stdio-link");
        target[used] = 0;
        check((S_ISFIFO(s.st_mode) && !strncmp(target, "pipe:[", 6))
            || (S_ISCHR(s.st_mode) && s.st_rdev == makedev(1, 3)
                && !strcmp(target, "/dev/null")), "stdio-only-trusted-pipes-or-null");
    }
}
static uint64_t monotonic_ms(void) {
    struct timespec t; check(clock_gettime(CLOCK_MONOTONIC, &t) == 0, "clock");
    return (uint64_t)t.tv_sec * 1000U + (uint64_t)t.tv_nsec / 1000000U;
}
static void run_tool(char *const argv[], int stdin_fd) {
    pid_t child = fork(); check(child >= 0, "trusted-tool-fork");
    if (child == 0) {
        if (stdin_fd >= 0) check(dup2(stdin_fd, STDIN_FILENO) >= 0, "tool-stdin");
        close_nonstdio();
        execve(argv[0], argv, trusted_env); fail("trusted-tool-exec");
    }
    int state = 0; uint64_t deadline = monotonic_ms() + 3000U;
    for (;;) {
        pid_t value = waitpid(child, &state, WNOHANG);
        if (value == child) break;
        if (value < 0 && errno == EINTR) continue;
        check(value == 0, "trusted-tool-wait");
        if (monotonic_ms() >= deadline) {
            check(kill(child, SIGKILL) == 0 || errno == ESRCH, "trusted-tool-timeout-kill");
            while (waitpid(child, &state, 0) < 0) check(errno == EINTR, "trusted-tool-timeout-join");
            errno = ETIMEDOUT; fail("trusted-tool-timeout");
        }
        struct timespec pause = {.tv_sec = 0, .tv_nsec = 10000000};
        nanosleep(&pause, NULL);
    }
    check(WIFEXITED(state) && WEXITSTATUS(state) == 0, "trusted-tool-status");
}
static void require_only_lo(void) {
    FILE *f = fopen("/proc/net/dev", "re"); check(f != NULL, "interfaces-open");
    char line[512]; size_t count = 0;
    while (fgets(line, sizeof(line), f)) {
        char *colon = strchr(line, ':'); if (!colon) continue; *colon = 0;
        char name[64], extra[2];
        check(sscanf(line, "%63s %1s", name, extra) == 1 && !strcmp(name, "lo"), "only-loopback");
        ++count;
    }
    check(fclose(f) == 0 && count == 1, "one-loopback-close");
}
static void setup_rules(unsigned port) {
    char rules[2048]; int length = snprintf(rules, sizeof(rules), nft_template, port, port, port, port);
    check(length > 0 && (size_t)length < sizeof(rules), "nft-rules-fit");
    int input = (int)syscall(__NR_memfd_create, "m2-private-http-rules", MFD_CLOEXEC | MFD_ALLOW_SEALING);
    check(input >= 0, "nft-input-memfd");
    size_t offset = 0;
    while (offset < (size_t)length) {
        ssize_t written = write(input, rules + offset, (size_t)length - offset);
        if (written < 0 && errno == EINTR) continue;
        check(written > 0, "nft-input-write"); offset += (size_t)written;
    }
    check(fcntl(input, F_ADD_SEALS, F_SEAL_SEAL | F_SEAL_SHRINK | F_SEAL_GROW | F_SEAL_WRITE) == 0, "nft-input-seal");
    check(lseek(input, 0, SEEK_SET) == 0, "nft-input-rewind");
    char *const nft_args[] = {"/usr/sbin/nft", "-f", "-", NULL};
    run_tool(nft_args, input); check(close(input) == 0, "nft-input-close");
}
static void drop_caps(void) {
    FILE *f = fopen("/proc/sys/kernel/cap_last_cap", "re");
    check(f != NULL, "cap-last-open"); unsigned last = 0;
    check(fscanf(f, "%u", &last) == 1 && last < 64, "cap-last-supported");
    check(fclose(f) == 0, "cap-last-close");
    for (unsigned i = 0; i <= last; ++i) check(prctl(PR_CAPBSET_DROP, i, 0, 0, 0) == 0, "drop-bounding");
    check(prctl(PR_CAP_AMBIENT, PR_CAP_AMBIENT_CLEAR_ALL, 0, 0, 0) == 0, "clear-ambient");
    struct __user_cap_header_struct header = {.version = _LINUX_CAPABILITY_VERSION_3, .pid = 0};
    struct __user_cap_data_struct data[2] = {{0}};
    check(syscall(__NR_capset, &header, data) == 0, "capset-zero");
    check(prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) == 0, "nnp");
}
static int restrict_network(unsigned port) {
    int abi = (int)syscall(__NR_landlock_create_ruleset, NULL, 0, LANDLOCK_CREATE_RULESET_VERSION);
    check(abi >= 4, "landlock-network-abi");
    struct landlock_ruleset_attr attr = {.handled_access_fs = 0,
        .handled_access_net = LANDLOCK_ACCESS_NET_BIND_TCP | LANDLOCK_ACCESS_NET_CONNECT_TCP};
    int fd = (int)syscall(__NR_landlock_create_ruleset, &attr, sizeof(attr), 0);
    check(fd >= 0, "landlock-create");
    struct landlock_net_port_attr rule = {.allowed_access = attr.handled_access_net, .port = port};
    check(syscall(__NR_landlock_add_rule, fd, LANDLOCK_RULE_NET_PORT, &rule, 0) == 0, "landlock-port");
    check(syscall(__NR_landlock_restrict_self, fd, 0) == 0, "landlock-restrict");
    check(close(fd) == 0, "landlock-close");
    struct sock_fprog program = {.len = (unsigned short)(sizeof(seccomp_program) / sizeof(seccomp_program[0])),
        .filter = (struct sock_filter *)seccomp_program};
    check(prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &program, 0, 0) == 0, "seccomp-install");
    return abi;
}

int main(int argc, char **argv) {
    /* No project-controlled environment reaches libc/tool exec privileged setup.
     * Static ELF has no interpreter/LD_PRELOAD startup path. The trusted oracle
     * may pass approved focusedEnvironment only to its restricted server child.
     */
    check(clearenv() == 0, "clear-environment");
    check(argc >= 12 && argc <= 10 + MAX_CHILD_ARGS, "argv-count");
    check(!strcmp(argv[1], "--profile") && !strcmp(argv[2], PROFILE)
        && !strcmp(argv[3], "--host-user-namespace") && valid_ns_arg(argv[4], "user:[")
        && !strcmp(argv[5], "--host-net-namespace") && valid_ns_arg(argv[6], "net:[")
        && !strcmp(argv[7], "--port") && !strcmp(argv[9], "--"), "exact-argv");
    /* argv[10] is the pinned runtime executable; argv[11] the pinned plain oracle.
     * Parent validates their inode/bytes and excludes generated paths before any
     * file effect. Do not offer a shell, PATH lookup, raw policy or model FD port.
     */
    check(argv[10][0] == '/' && argv[11][0] == '/', "absolute-trusted-runtime-oracle");
    size_t child_bytes = 0;
    for (int i = 10; i < argc; ++i) {
        child_bytes += strlen(argv[i]) + 1;
        check(child_bytes <= MAX_CHILD_ARG_BYTES, "bounded-child-argv");
    }
    const char *p = argv[8]; check(*p >= '1' && *p <= '9', "port-canonical");
    while (*p >= '0' && *p <= '9') ++p;
    check(*p == 0, "port-decimal"); errno = 0;
    unsigned long raw_port = strtoul(argv[8], NULL, 10);
    check(errno == 0 && raw_port >= 1024 && raw_port <= 65535, "port-range");
    unsigned port = (unsigned)raw_port;
    struct utsname machine; check(uname(&machine) == 0 && !strcmp(machine.machine, "x86_64"), "architecture");
    require_stdio(); close_nonstdio(); require_caps(SETUP_CAPS);
    char user_ns[64], old_net[64], new_net[64];
    ns_link("user", user_ns, sizeof(user_ns)); ns_link("net", old_net, sizeof(old_net));
    check(strcmp(user_ns, argv[4]) && strcmp(old_net, argv[6]), "not-host-namespaces");
    check(unshare(CLONE_NEWNET) == 0, "new-owned-netns");
    ns_link("net", new_net, sizeof(new_net));
    char after_user[64]; ns_link("user", after_user, sizeof(after_user));
    check(strcmp(new_net, old_net) && strcmp(new_net, argv[6]) && !strcmp(user_ns, after_user), "distinct-owned-netns");
    int net_fd = open("/proc/self/ns/net", O_RDONLY | O_CLOEXEC);
    check(net_fd >= 0, "namespace-open");
    int owner_fd = ioctl(net_fd, NS_GET_USERNS); check(owner_fd >= 0, "namespace-owner");
    struct stat owner, self; check(fstat(owner_fd, &owner) == 0 && stat("/proc/self/ns/user", &self) == 0, "namespace-inodes");
    check(owner.st_dev == self.st_dev && owner.st_ino == self.st_ino, "netns-owned-by-current-userns");
    check(close(owner_fd) == 0 && close(net_fd) == 0, "namespace-fds-close");
    require_only_lo();
    char *const ip_args[] = {"/usr/bin/ip", "link", "set", "dev", "lo", "up", NULL};
    run_tool(ip_args, -1); require_only_lo(); setup_rules(port);
    drop_caps(); int abi = restrict_network(port); close_nonstdio();
    require_caps(0);
    check(read_status("NoNewPrivs", 0) == 1 && read_status("Seccomp", 0) == SECCOMP_MODE_FILTER, "restricted-child-state");
    fprintf(stderr, "M2_PRIVATE_HTTP_READY profile=%s address=127.0.0.1 port=%u landlockAbi=%d"
        " user=%s oldNet=%s ownNet=%s ownerInode=%ju currentUserInode=%ju capsets=0 nnp=1 seccomp=2\n",
        PROFILE, port, abi, user_ns, old_net, new_net, (uintmax_t)owner.st_ino, (uintmax_t)self.st_ino);
    check(fflush(stderr) == 0, "metadata-flush");
    execve(argv[10], &argv[10], trusted_env);
    fail("restricted-oracle-exec");
}
