// Called only after doPost validates the existing executor TOKEN.
// No writes, sharing changes, saved copies, or OAuth credentials in the response.
function nexusReadImage(body) {
  try {
    var allowed = JSON.parse(propiedad('ARTES_DESTINOS', true));
    if (allowed.indexOf(body.folderId) < 0 || !/^[A-Za-z0-9_-]{20,100}$/.test(body.fileId || '') ||
        typeof body.viewer !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.viewer)) throw new Error('denied');
    var file = DriveApp.getFileById(body.fileId);
    if (file.isTrashed() || !nexusArteWithin(file, body.folderId)) throw new Error('denied');
    // The viewer is supplied by the authenticated database, never by the browser.
    // Fail closed for group-only access, which getAccess cannot resolve.
    var permission = file.getAccess(body.viewer);
    var writer = permission === DriveApp.Permission.OWNER || permission === DriveApp.Permission.EDIT;
    if (!writer && permission !== DriveApp.Permission.VIEW && permission !== DriveApp.Permission.COMMENT) throw new Error('denied');
    var meta = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(body.fileId) +
      '?fields=id,mimeType,size,copyRequiresWriterPermission,capabilities(canDownload)&supportsAllDrives=true', {
      headers: {Authorization:'Bearer ' + ScriptApp.getOAuthToken()}, muteHttpExceptions:true
    });
    if (meta.getResponseCode() !== 200) throw new Error('denied');
    var m = JSON.parse(meta.getContentText());
    if (m.id !== body.fileId || !m.capabilities || m.capabilities.canDownload !== true ||
        (m.copyRequiresWriterPermission === true && !writer)) throw new Error('denied');
    if (['image/jpeg','image/png','image/webp'].indexOf(m.mimeType) < 0 || Number(m.size) < 1 || Number(m.size) > 8 * 1024 * 1024) {
      return json({ok:false,error:'La imagen debe ser JPG, PNG o WebP de hasta 8 MiB.'});
    }
    var bytes = file.getBlob().getBytes();
    if (bytes.length !== Number(m.size)) throw new Error('changed');
    return json({ok:true,id:body.fileId,mime:m.mimeType,bytes:bytes.length,data:Utilities.base64Encode(bytes)});
  } catch (e) {
    return json({ok:false,error:'No se pudo leer la imagen con los permisos actuales de tu cuenta.'});
  }
}
