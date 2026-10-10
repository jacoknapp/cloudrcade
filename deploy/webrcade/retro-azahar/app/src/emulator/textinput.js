// Keep text entry synchronous: the minimal-Asyncify CPU callbacks cannot unwind
// for a Promise-based keyboard. A native prompt also supplies the iPhone keyboard.
export function requestGameText({ hint, maxLength }) {
  const label = hint || 'Enter text:';
  const limit = Number.isInteger(maxLength) && maxLength > 0 ? maxLength : 0;
  let message = limit ? `${label}\nUp to ${limit} characters.` : label;
  let previous = '';
  for (;;) {
    const text = window.prompt(message, previous);
    if (text === null || !limit || text.length <= limit) return text;
    previous = text;
    message = `Use no more than ${limit} characters.\n${label}`;
  }
}
