// public/pyodide.worker.js
/* global importScripts, loadPyodide */

// Runs Pyodide in a separate thread so infinite loops don't freeze the UI

importScripts('https://cdn.jsdelivr.net/pyodide/v0.25.0/full/pyodide.js');

let pyodideReadyPromise;

async function loadPyodideAndPackages() {
  self.pyodide = await loadPyodide({
    indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.25.0/full/'
  });
  
  // Set up Python standard output/error redirection
  self.pyodide.runPython(`
import sys, io

class JSWriter(io.StringIO):
    def __init__(self, stream_type):
        super().__init__()
        self.stream_type = stream_type
        
    def write(self, s):
        if not s: return
        import js
        js.postMessage(js.Object.fromEntries([
            ('__python_output', True),
            ('stream', self.stream_type),
            ('text', s)
        ]))

sys.stdout = JSWriter('stdout')
sys.stderr = JSWriter('stderr')

def __debug_trace(frame, event, arg):
    if event != 'line':
        return __debug_trace
    
    # Only trace code without a filename (the user's code in runPython)
    if frame.f_code.co_filename != '<exec>':
        return __debug_trace

    # Capture locals (shallow copy to avoid circular refs/bloat)
    l = {k: str(v) for k, v in frame.f_locals.items() if not k.startswith('__')}
    
    import js
    js.postMessage(js.Object.fromEntries([
        ('__debug_step', True),
        ('line', frame.f_lineno),
        ('locals', js.Object.fromEntries(l.items()))
    ]))
    return __debug_trace

def start_debug():
    sys.settrace(__debug_trace)

def stop_debug():
    sys.settrace(None)
`);
}

pyodideReadyPromise = loadPyodideAndPackages();

self.onmessage = async (event) => {
  const { id, code, debug = false } = event.data;
  if (!code) return;

  try {
    await pyodideReadyPromise;
    
    if (debug) {
      self.pyodide.runPython('start_debug()');
    } else {
      self.pyodide.runPython('stop_debug()');
    }

    // execute
    const result = await self.pyodide.runPythonAsync(code);

    if (debug) {
      self.pyodide.runPython('stop_debug()');
    }

    self.postMessage({ id, __python_done: true, results: String(result), error: null });
  } catch (error) {
    self.postMessage({ id, __python_done: true, error: error.message });
  }
};
