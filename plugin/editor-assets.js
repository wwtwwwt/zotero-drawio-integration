"use strict";

function registerEditorAssets(rootURI) {
  // A new origin prevents a live upgrade from mixing assets from two packages.
  const name = "diagram-attachments-" + Services.uuid.generateUUID().toString().slice(1, -1);
  const origin = "resource://" + name;
  const handler = Services.io.getProtocolHandler("resource").QueryInterface(Ci.nsIResProtocolHandler);
  handler.setSubstitutionWithFlags(name, Services.io.newURI(rootURI),
    Ci.nsISubstitutingProtocolHandler.ALLOW_CONTENT_ACCESS);
  return {
    origin,
    url: origin + "/web/host.html",
    remove: () => handler.setSubstitution(name, null),
  };
}
