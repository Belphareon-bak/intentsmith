const { app, dialog } = require('electron');
app.whenReady().then(() => {
  dialog.showErrorBox('IntentSmith se nepodařilo spustit', process.argv[2] || 'Neznámá chyba při spuštění.');
  app.quit();
});
