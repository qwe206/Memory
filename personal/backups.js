let database;
export async function saveLedgerBackup(worldbook, uid, entry) {
  database ||= new Promise((resolve, reject) => {
    const request = indexedDB.open('amily2-personal-ledger-backups', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('backups', { autoIncrement: true });
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  const db = await database;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('backups', 'readwrite');
    transaction.objectStore('backups').add({ worldbook, uid, entry: structuredClone(entry), savedAt: new Date().toISOString() });
    transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error || new Error('总结备份失败，原条目未修改。'));
  });
}
export async function exportLedgerBackups() {
  await saveLedgerBackup('__export_checkpoint__', '', {});
  const db = await database;
  return new Promise((resolve, reject) => {
    const request = db.transaction('backups').objectStore('backups').getAll();
    request.onsuccess = () => resolve(request.result.filter(row => row.worldbook !== '__export_checkpoint__')); request.onerror = () => reject(request.error);
  });
}
