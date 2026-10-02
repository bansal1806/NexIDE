// Remove capabilities user code has no business using inside the runner worker.
//
// A same-origin worker can't see localStorage or the DOM, but it can reach the origin's
// IndexedDB / Cache Storage / OPFS and spawn nested workers (which would start with a
// fresh, unrestricted global scope). Deleting the accessors from every object on the
// prototype chain means user code cannot get them back via Object.getPrototypeOf(self).
//
// Keep in sync with the copy in public/pyodide.worker.js.

export const BLOCKED_GLOBALS = ['indexedDB', 'caches', 'Worker', 'SharedWorker', 'BroadcastChannel', 'cookieStore'];
export const BLOCKED_NAVIGATOR = ['storage', 'serviceWorker'];

function removeEverywhere(obj, name) {
  for (let o = obj; o; o = Object.getPrototypeOf(o)) {
    const desc = Object.getOwnPropertyDescriptor(o, name);
    if (!desc) continue;
    if (desc.configurable) {
      delete o[name];
    } else if (desc.writable) {
      o[name] = undefined;
    }
  }
}

export function lockdownWorkerScope(scope = globalThis) {
  for (const name of BLOCKED_GLOBALS) removeEverywhere(scope, name);
  if (scope.navigator) {
    for (const name of BLOCKED_NAVIGATOR) removeEverywhere(scope.navigator, name);
  }
}
