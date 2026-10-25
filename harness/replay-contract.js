'use strict';

function sceneReplayIdentity(scene, sceneId) {
  return {
    sceneIsScene: !!scene && scene.isScene === true,
    sceneId,
  };
}

function sceneIdForReplay(identity) {
  if (!identity || identity.sceneIsScene !== true) {
    throw new Error('window.__cme.scene must remain the active THREE.Scene');
  }
  if (typeof identity.sceneId !== 'string' || identity.sceneId.length === 0) {
    throw new Error('window.__cme.sceneId must be a non-empty string');
  }
  return identity.sceneId;
}

function compareReplayScene(recordScene, identity) {
  let sceneId;
  try {
    sceneId = sceneIdForReplay(identity);
  } catch (error) {
    return error.message;
  }
  return sceneId === recordScene ? null : `scene ${sceneId} != recorded ${recordScene}`;
}

module.exports = { compareReplayScene, sceneIdForReplay, sceneReplayIdentity };
