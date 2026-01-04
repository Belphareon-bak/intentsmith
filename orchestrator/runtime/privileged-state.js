let privileged = false;

export function enablePrivilegedMode() {
  privileged = true;
}

export function disablePrivilegedMode() {
  privileged = false;
}

export function isPrivilegedMode() {
  return privileged;
}
