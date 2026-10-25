#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { compareReplayScene, sceneIdForReplay, sceneReplayIdentity } = require('./replay-contract');

let checks = 0;
function equal(actual, expected, message) { checks++; assert.equal(actual, expected, message); }
function deepEqual(actual, expected, message) { checks++; assert.deepEqual(actual, expected, message); }
function throws(callback, pattern, message) { checks++; assert.throws(callback, pattern, message); }
function matches(value, pattern, message) { checks++; assert.match(value, pattern, message); }
function notMatches(value, pattern, message) { checks++; assert.doesNotMatch(value, pattern, message); }

const eclipseCme = { scene: { isScene: true, id: 'three-object-id' }, sceneId: 'eclipse-act' };
const eclipseIdentity = sceneReplayIdentity(eclipseCme.scene, eclipseCme.sceneId);
equal(eclipseIdentity.sceneIsScene, true, 'runtime scene remains a THREE.Scene');
equal(eclipseIdentity.sceneId, 'eclipse-act', 'scene id comes from the distinct sceneId field');
equal(sceneIdForReplay(eclipseIdentity), 'eclipse-act', 'recording reads the sceneId string');
const newRecord = { format: 'cme-replay/3', scene: sceneIdForReplay(eclipseIdentity) };
deepEqual(JSON.parse(JSON.stringify(newRecord)),
  { format: 'cme-replay/3', scene: 'eclipse-act' },
  'serialization keeps the existing cme-replay/3 scene string field');
equal(compareReplayScene(newRecord.scene, eclipseIdentity), null,
  'replay comparison matches the string id while retaining the Scene object');
equal(compareReplayScene('mimas', eclipseIdentity), 'scene eclipse-act != recorded mimas',
  'replay comparison still detects a scene-id mismatch');

const mimasScene = { isScene: true, id: 'scene-object-is-not-the-recorded-id' };
equal(compareReplayScene('mimas', sceneReplayIdentity(mimasScene, 'mimas')), null,
  'frozen Mimas corpus identity remains compatible');
const frozenPath = path.join(__dirname, 'replay-records',
  'replay-seed7-ch1-1440x900-cinematic-rmon.json');
const frozenRecord = JSON.parse(fs.readFileSync(frozenPath, 'utf8'));
equal(frozenRecord.format, 'cme-replay/3', 'frozen record format stays unchanged');
equal(frozenRecord.scene, 'mimas', 'frozen record keeps its scene string');
equal(Object.hasOwn(frozenRecord, 'sceneId'), false, 'frozen corpus is not rewritten with a new field');

throws(() => sceneIdForReplay(sceneReplayIdentity('mimas', 'mimas')), /THREE\.Scene/,
  'a string in cme.scene is rejected as a broken runtime identity');
throws(() => sceneIdForReplay(sceneReplayIdentity({ isScene: true }, '')), /sceneId/,
  'empty scene ids are rejected');
equal(compareReplayScene('mimas', sceneReplayIdentity(null, 'mimas')),
  'window.__cme.scene must remain the active THREE.Scene',
  'comparison reports a missing live Scene object');

const replaySource = fs.readFileSync(path.join(__dirname, 'replay.js'), 'utf8');
const phase7Source = fs.readFileSync(path.join(__dirname, 'checks-phase7.js'), 'utf8');
const eclipseProbeSource = fs.readFileSync(path.join(__dirname, 'probe-eclipse.js'), 'utf8');
const eclipsePageSource = fs.readFileSync(path.join(__dirname, '..', 'scenes', 'eclipse', 'index.html'), 'utf8');
matches(replaySource, /sceneId:\s*cme\.sceneId/, 'replay reads the runtime sceneId');
matches(replaySource, /sceneIsScene:\s*!!cme\.scene\s*&&\s*cme\.scene\.isScene\s*===\s*true/,
  'replay asserts the runtime scene is still a THREE.Scene');
matches(replaySource, /scene:\s*sceneIdForReplay\(r\)/,
  'replay writes the string into the existing scene field');
matches(replaySource, /compareReplayScene\(record\.scene,\s*r\)/,
  'replay comparison uses sceneId through the identity helper');
notMatches(replaySource, /scene:\s*cme\.scene\s*[,}]/,
  'replay never serializes the Scene object');
matches(phase7Source, /sceneId:\s*e\.sceneId/,
  'Phase 7 reads the eclipse scene identifier from sceneId');
matches(phase7Source, /sceneIsScene:\s*!!e\.scene\s*&&\s*e\.scene\.isScene\s*===\s*true/,
  'Phase 7 asserts the live THREE.Scene remains available');
matches(phase7Source, /r\.sceneIsScene\s*===\s*true\s*&&\s*r\.sceneId\s*===\s*'eclipse-act'/,
  'Phase 7 compares the id and object contract separately');
notMatches(phase7Source, /scene:\s*e\.scene\s*[,}]/,
  'Phase 7 does not treat the Scene object as its id');
matches(eclipseProbeSource, /const e = window\.__eclipse;[\s\S]*?sceneId:\s*e\.scene\.id/,
  'standalone eclipse probe keeps its distinct scene-config contract');
matches(eclipsePageSource, /window\.__eclipse = \{[\s\S]*?scene:\s*ECLIPSE_SCENE/,
  'standalone eclipse page exposes its config under window.__eclipse.scene');

console.log(`scene identity offline tests: ${checks} passed`);
