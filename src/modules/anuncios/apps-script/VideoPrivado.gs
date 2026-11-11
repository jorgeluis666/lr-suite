// Called only after doPost validates the existing executor TOKEN.
// No writes, sharing changes, saved copies, or OAuth credentials in the response.
function nexusReadVideo(body) {
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
    if (m.mimeType !== 'video/mp4' || Number(m.size) < 1 || Number(m.size) > 45 * 1024 * 1024) {
      return json({ok:false,error:'El reproductor admite MP4 de hasta 45 MB.'});
    }
    var bytes = file.getBlob().getBytes();
    if (bytes.length !== Number(m.size)) throw new Error('changed');
    return json({ok:true,id:body.fileId,mime:'video/mp4',bytes:bytes.length,data:Utilities.base64Encode(bytes)});
  } catch (e) {
    return json({ok:false,error:'No se pudo leer el video con los permisos actuales de tu cuenta.'});
  }
}

// Called only after doPost validates the existing executor TOKEN.
// No writes, sharing changes, saved copies, or OAuth credentials in the response.
function nexusReadVideoChunk(body) {
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
      '?fields=id,mimeType,size,version,copyRequiresWriterPermission,capabilities(canDownload)&supportsAllDrives=true', {
      headers: {Authorization:'Bearer ' + ScriptApp.getOAuthToken()}, muteHttpExceptions:true
    });
    if (meta.getResponseCode() !== 200) throw new Error('denied');
    var m = JSON.parse(meta.getContentText());
    if (m.id !== body.fileId || !m.capabilities || m.capabilities.canDownload !== true ||
        (m.copyRequiresWriterPermission === true && !writer)) throw new Error('denied');
    var total = Number(m.size), offset = body.offset, block = 8 * 1024 * 1024;
    if (m.mimeType !== 'video/mp4' || !Number.isSafeInteger(total) || total < 1 || total > 256 * 1024 * 1024)
      return json({ok:false,error:'Este reproductor admite MP4 de hasta 256 MiB.'});
    if (!Number.isSafeInteger(offset) || offset < 0 || offset >= total || offset % block !== 0) throw new Error('range');
    var version = String(m.version || '');
    if (!/^\d+$/.test(version) || (offset > 0 && body.version !== version) ||
        (body.version && body.version !== version)) throw new Error('changed');
    var last = Math.min(offset + block, total) - 1;
    var part = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(body.fileId) + '?alt=media&supportsAllDrives=true', {
      headers:{Authorization:'Bearer ' + ScriptApp.getOAuthToken(), Range:'bytes=' + offset + '-' + last}, muteHttpExceptions:true
    });
    var headers = part.getAllHeaders(), contentRange = '';
    Object.keys(headers).forEach(function(k){if(k.toLowerCase()==='content-range') contentRange=String(headers[k]);});
    if (part.getResponseCode() !== 206 || contentRange !== 'bytes ' + offset + '-' + last + '/' + total) throw new Error('range');
    var bytes = part.getContent();
    if (bytes.length !== last - offset + 1) throw new Error('incomplete');
    var after = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(body.fileId) + '?fields=version&supportsAllDrives=true', {
      headers:{Authorization:'Bearer ' + ScriptApp.getOAuthToken()}, muteHttpExceptions:true
    });
    if (after.getResponseCode() !== 200 || String(JSON.parse(after.getContentText()).version) !== version) throw new Error('changed');
    return json({ok:true,id:body.fileId,mime:'video/mp4',bytes:bytes.length,total:total,offset:offset,version:version,data:Utilities.base64Encode(bytes)});
  } catch (e) {
    return json({ok:false,error:'No se pudo leer el video con los permisos actuales de tu cuenta.'});
  }
}
