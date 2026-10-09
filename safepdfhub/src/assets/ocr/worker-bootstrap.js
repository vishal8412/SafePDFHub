/* Same-origin Tesseract bootstrap. Allows cancellation while createWorker is still
 * downloading/initializing, before its public terminate() method becomes available. */
const channelName = new URL(self.location.href).searchParams.get('session');
if (channelName && typeof BroadcastChannel !== 'undefined') {
  const cancellation = new BroadcastChannel(channelName);
  cancellation.onmessage = () => {
    cancellation.close();
    self.close();
  };
}
importScripts('./worker.min.js');
