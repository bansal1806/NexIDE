import { describe, it, expect } from 'vitest';
import { lockdownWorkerScope } from './lockdown';

// Mimic a worker global: accessors live on prototypes, as in WorkerGlobalScope
function fakeScope() {
  const WorkerGlobalScopeProto = {};
  Object.defineProperty(WorkerGlobalScopeProto, 'indexedDB', { get: () => ({ open() {} }), configurable: true });
  Object.defineProperty(WorkerGlobalScopeProto, 'caches', { get: () => ({}), configurable: true });
  const NavigatorProto = {};
  Object.defineProperty(NavigatorProto, 'storage', { get: () => ({ getDirectory() {} }), configurable: true });
  const scope = Object.create(WorkerGlobalScopeProto);
  Object.defineProperty(scope, 'Worker', { value: function Worker() {}, configurable: true, writable: true });
  scope.navigator = Object.create(NavigatorProto);
  scope.fetch = () => {};
  return scope;
}

describe('lockdownWorkerScope', () => {
  it('removes storage and worker-spawning APIs, including from prototypes', () => {
    const scope = fakeScope();
    lockdownWorkerScope(scope);
    expect(scope.indexedDB).toBeUndefined();
    expect(scope.caches).toBeUndefined();
    expect(scope.Worker).toBeUndefined();
    expect(scope.navigator.storage).toBeUndefined();
    const proto = Object.getPrototypeOf(scope);
    expect(Object.getOwnPropertyDescriptor(proto, 'indexedDB')).toBeUndefined();
  });

  it('leaves unrelated capabilities alone', () => {
    const scope = fakeScope();
    lockdownWorkerScope(scope);
    expect(typeof scope.fetch).toBe('function');
  });
});
