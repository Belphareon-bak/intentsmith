// Trusted private namespace observation. Sysfs is an informational filesystem
// view; proc-self network data and ip netlink describe the current actual netns.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
function ipJson(args) {
  const response = spawnSync('/usr/sbin/ip', ['-j', ...args],
    {encoding: 'utf8', timeout: 3000, maxBuffer: 256_000});
  assert.equal(response.error, undefined, 'HUNT_NETWORK_IP_OBSERVATION_FAILED');
  assert.equal(response.status, 0, 'HUNT_NETWORK_IP_OBSERVATION_FAILED');
  assert.equal(response.signal, null);
  const value = JSON.parse(response.stdout); assert.ok(Array.isArray(value));
  return value;
}
const sorted = names => [...names].sort((a,b) => a < b ? -1 : a > b ? 1 : 0);
export function observeLoopbackOnlyNetwork({parentNamespace, expectedNamespace}) {
  const namespace = fs.readlinkSync('/proc/self/ns/net');
  assert.equal(namespace, expectedNamespace, 'HUNT_NETWORK_NAMESPACE_IDENTITY');
  assert.notEqual(namespace, parentNamespace, 'HUNT_NETWORK_HOST_NAMESPACE');
  const procInterfaces = sorted(fs.readFileSync('/proc/self/net/dev', 'utf8')
    .split('\n').filter(line => line.includes(':')).map(line => line.slice(0,line.indexOf(':')).trim()));
  const links = ipJson(['link','show']);
  const kernelInterfaces = sorted(links.map(link => link.ifname));
  const routes4 = ipJson(['-4','route','show','table','all']);
  const routes6 = ipJson(['-6','route','show','table','all']);
  const observation = {namespace, parentNamespace, procInterfaces, kernelInterfaces,
    links, routes4, routes6, sysfsFilesystemView: sorted(fs.readdirSync('/sys/class/net')),
    authority: 'current /proc/self/net/dev + kernel netlink; sysfs is not network-namespace authority'};
  try {
    assert.deepEqual(procInterfaces, kernelInterfaces, 'HUNT_NETWORK_KERNEL_OBSERVATION_MISMATCH');
    assert.equal([...routes4,...routes6].every(route => route.dev === 'lo'
      && (!route.nexthops || route.nexthops.every(hop => hop.dev === 'lo'))), true,
      'HUNT_NETWORK_NON_LOOPBACK_ROUTE');
    assert.deepEqual(kernelInterfaces, ['lo'], 'HUNT_NETWORK_NON_LOOPBACK_INTERFACE');
    assert.equal(links[0].flags.includes('LOOPBACK') && links[0].flags.includes('UP'), true,
      'HUNT_NETWORK_LOOPBACK_NOT_UP');
  } catch (error) {error.networkObservation = observation; throw error;}
  return observation;
}
