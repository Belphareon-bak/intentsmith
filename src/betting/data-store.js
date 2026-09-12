// Host-owned isolated research database. No shared IntentSmith DB migrations.
import Database from 'better-sqlite3';
import {mkdirSync,chmodSync,lstatSync} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {up as installOutboundAudit} from '../db/migrations/2026_08_26_089_m5_outbound_audit.js';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export class BettingDataStore {
  constructor(filename) {
    if(filename!==':memory:'){
      mkdirSync(path.dirname(filename),{recursive:true,mode:0o700});
      try {if(lstatSync(filename).isSymbolicLink())throw new Error('BETTING_STORE_SYMLINK');} catch(e){if(e.code!=='ENOENT')throw e;}
    }
    this.database=new Database(filename);if(filename!==':memory:')chmodSync(filename,0o600);
    this.database.pragma('journal_mode = WAL');this.database.pragma('foreign_keys = ON');
    const version=this.database.pragma('user_version',{simple:true});
    if(version!==0&&version!==1)throw new Error('BETTING_STORE_SCHEMA_VERSION');
    if(version===0)this.database.transaction(()=>{
      if(this.database.pragma('user_version',{simple:true})===1)return;
      installOutboundAudit(this.database);
      this.database.exec(`CREATE TABLE betting_blobs(sha256 TEXT PRIMARY KEY, content BLOB NOT NULL, CHECK(length(sha256)=64));
        CREATE TABLE betting_observations(id TEXT PRIMARY KEY, resource TEXT NOT NULL, retrieved_at TEXT NOT NULL, last_modified TEXT, sha256 TEXT NOT NULL REFERENCES betting_blobs(sha256), url TEXT NOT NULL);
        CREATE INDEX betting_observations_resource ON betting_observations(resource,retrieved_at);
        CREATE TABLE betting_runs(id TEXT PRIMARY KEY, occurred_at TEXT NOT NULL, record_json TEXT NOT NULL CHECK(json_valid(record_json)));
        PRAGMA user_version=1;`);
    }).immediate();
    // Reuse the exact authoritative outbound schema and fingerprint validator.
    installOutboundAudit(this.database);
  }
  latest(resource) {
    const r=this.database.prepare('SELECT o.*,b.content FROM betting_observations o JOIN betting_blobs b USING(sha256) WHERE resource=? ORDER BY retrieved_at DESC,id DESC LIMIT 1').get(resource);
    if(!r)return null;if(hash(r.content)!==r.sha256)throw new Error('BETTING_CACHE_DIGEST_MISMATCH');
    return {content:r.content.toString('utf8'),sourceRef:{observationId:r.id,resource:r.resource,retrievedAt:r.retrieved_at,lastModified:r.last_modified,sha256:r.sha256,url:r.url,bytes:r.content.length}};
  }
  record(resource,url,bytes,{retrievedAt,lastModified=null}) {
    // Persisted URLs are public source locations; API keys never enter the store.
    const u=new URL(url);if(u.search||u.username||u.password||bytes.length>4_000_000||!Number.isFinite(Date.parse(retrievedAt)))throw new Error('BETTING_SOURCE_RECORD_INVALID');
    const sha256=hash(bytes),id=randomUUID();
    this.database.transaction(()=>{
      this.database.prepare('INSERT OR IGNORE INTO betting_blobs VALUES (?,?)').run(sha256,bytes);
      this.database.prepare('INSERT INTO betting_observations VALUES (?,?,?,?,?,?)').run(id,resource,retrievedAt,lastModified,sha256,url);
    })();
    return {content:bytes.toString('utf8'),sourceRef:{observationId:id,resource,retrievedAt,lastModified,sha256,url,bytes:bytes.length}};
  }
  recordRun(record) {
    if(!record||JSON.stringify(record).length>8_000_000)throw new Error('BETTING_RUN_INVALID');
    const id=randomUUID();this.database.prepare('INSERT INTO betting_runs VALUES (?,?,?)').run(id,new Date().toISOString(),JSON.stringify(record));return id;
  }
  close(){this.database.close();}
}
