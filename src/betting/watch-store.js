import {randomUUID} from 'node:crypto';

// Derived watch state in the specialist's own database; no shared migrations.
export class BettingWatchStore {
  constructor(store) {
    this.db=store.database;this.db.pragma('busy_timeout = 5000');
    if(!this.db.prepare("SELECT 1 FROM sqlite_master WHERE name='betting_watch_meta'").get())this.db.transaction(()=>{
      if(this.db.prepare("SELECT 1 FROM sqlite_master WHERE name='betting_watch_meta'").get())return;
      this.db.exec(`CREATE TABLE betting_watch_meta(version INTEGER NOT NULL CHECK(version=1));
        INSERT INTO betting_watch_meta VALUES(1);
        CREATE TABLE betting_watch_lease(id INTEGER PRIMARY KEY CHECK(id=1), token TEXT NOT NULL, expires_at INTEGER NOT NULL);
        CREATE TABLE betting_watch_scans(id INTEGER PRIMARY KEY, scope TEXT NOT NULL, at TEXT NOT NULL, from_at TEXT NOT NULL, to_at TEXT NOT NULL, run_id TEXT NOT NULL, quotes INTEGER NOT NULL, signals INTEGER NOT NULL);
        CREATE INDEX betting_watch_scans_scope ON betting_watch_scans(scope,id);
        CREATE TABLE betting_watch_history(key TEXT PRIMARY KEY, event_id TEXT NOT NULL, first_seen TEXT NOT NULL, last_json TEXT NOT NULL, last_alert_at TEXT, last_alert_price REAL);
        CREATE INDEX betting_watch_history_event ON betting_watch_history(event_id);
        CREATE TABLE betting_watch_quotes(scan_id INTEGER NOT NULL REFERENCES betting_watch_scans(id), key TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY(scan_id,key));
        CREATE TABLE betting_watch_alerts(id TEXT PRIMARY KEY, at TEXT NOT NULL, expires_at TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('local','pending','sending','sent','unknown','expired')), recipient_hash TEXT, message_id TEXT, error_code TEXT);
        CREATE INDEX betting_watch_alerts_status ON betting_watch_alerts(status,at);
        CREATE TABLE betting_watch_health(id INTEGER PRIMARY KEY CHECK(id=1), attempted_at TEXT NOT NULL, success INTEGER NOT NULL, error_code TEXT);`);
    }).immediate();
    if(this.db.prepare('SELECT version FROM betting_watch_meta').get()?.version!==1)throw new Error('WATCH_SCHEMA_INVALID');
  }
  acquire(now) {
    const token=randomUUID();
    this.db.transaction(()=>{
      const existing=this.db.prepare('SELECT * FROM betting_watch_lease WHERE id=1').get();
      if(existing&&existing.expires_at>now)throw new Error('WATCH_ALREADY_RUNNING');
      this.db.prepare('INSERT OR REPLACE INTO betting_watch_lease VALUES(1,?,?)').run(token,now+180000);
      // The process may have died after SMTP acceptance. Never auto-resend.
      this.db.prepare("UPDATE betting_watch_alerts SET status='unknown',error_code='INTERRUPTED_SEND' WHERE status='sending'").run();
    })();return token;
  }
  requireLease(token,now){if(!this.db.prepare('SELECT 1 FROM betting_watch_lease WHERE id=1 AND token=? AND expires_at>?').get(token,now))throw new Error('WATCH_LEASE_EXPIRED');}
  release(token){this.db.prepare('DELETE FROM betting_watch_lease WHERE id=1 AND token=?').run(token);}
  previous(scope){const r=this.db.prepare('SELECT * FROM betting_watch_scans WHERE scope=? ORDER BY id DESC LIMIT 1').get(scope);return r?{at:r.at,from:r.from_at,to:r.to_at}:null;}
  history(quotes){
    const ids=[...new Set(quotes.map(q=>q.eventId))];if(!ids.length)return {};
    const rows=this.db.prepare(`SELECT * FROM betting_watch_history WHERE event_id IN (${ids.map(()=>'?').join(',')})`).all(...ids);
    return Object.fromEntries(rows.map(r=>[r.key,{firstSeenAt:r.first_seen,last:JSON.parse(r.last_json),lastAlert:r.last_alert_at?{at:r.last_alert_at,price:r.last_alert_price}:null}]));
  }
  save({token,now,scope,from,to,runId,quotes,signals,recipientHash=null}) {
    return this.db.transaction(()=>{
      this.requireLease(token,Date.parse(now));
      const id=Number(this.db.prepare('INSERT INTO betting_watch_scans(scope,at,from_at,to_at,run_id,quotes,signals) VALUES(?,?,?,?,?,?,?)').run(scope,now,from,to,runId,quotes.length,signals.length).lastInsertRowid);
      const history=this.db.prepare('INSERT INTO betting_watch_history(key,event_id,first_seen,last_json) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET last_json=excluded.last_json');
      const quote=this.db.prepare('INSERT INTO betting_watch_quotes VALUES(?,?,?)');
      for(const q of quotes){const json=JSON.stringify(q);history.run(q.key,q.eventId,q.observedAt,json);quote.run(id,q.key,json);}
      for(const s of signals){
        this.db.prepare('INSERT INTO betting_watch_alerts(id,at,expires_at,payload,status,recipient_hash) VALUES(?,?,?,?,?,?)').run(s.id,now,s.quote.expiresAt,JSON.stringify(s),recipientHash?'pending':'local',recipientHash);
        this.db.prepare('UPDATE betting_watch_history SET last_alert_at=?,last_alert_price=? WHERE key=?').run(now,s.quote.decimalOdds,s.quote.key);
      }
      this.db.prepare('INSERT OR REPLACE INTO betting_watch_health VALUES(1,?,1,NULL)').run(now);
      return id;
    })();
  }
  failed(now,code){this.db.prepare('INSERT OR REPLACE INTO betting_watch_health VALUES(1,?,0,?)').run(now,code);}
  claimMail({token,now,recipientHash,maxPerDay}) {
    return this.db.transaction(()=>{
      this.requireLease(token,Date.parse(now));
      this.db.prepare("UPDATE betting_watch_alerts SET status='expired',error_code='EXPIRED_OR_RECIPIENT_CHANGED' WHERE status='pending' AND (expires_at<=? OR recipient_hash<>?)").run(now,recipientHash);
      const count=this.db.prepare("SELECT count(*) n FROM betting_watch_alerts WHERE status IN ('sending','sent','unknown') AND at>?").get(new Date(Date.parse(now)-86400000).toISOString()).n;
      if(count>=maxPerDay)return null;
      const row=this.db.prepare("SELECT * FROM betting_watch_alerts WHERE status='pending' AND recipient_hash=? ORDER BY at DESC,COALESCE(json_extract(payload,'$.improvement'),0) DESC,json_extract(payload,'$.quote.marketProbability') DESC,id LIMIT 1").get(recipientHash);
      if(!row)return null;
      this.db.prepare("UPDATE betting_watch_alerts SET status='sending' WHERE id=? AND status='pending'").run(row.id);
      return {id:row.id,signal:JSON.parse(row.payload)};
    })();
  }
  finishMail(id,{accepted=false,messageId=null,errorCode=null}){
    this.db.prepare("UPDATE betting_watch_alerts SET status=?,message_id=?,error_code=? WHERE id=? AND status='sending'").run(accepted?'sent':'unknown',messageId,errorCode,id);
  }
  alerts(limit=10){return this.db.prepare('SELECT * FROM betting_watch_alerts ORDER BY at DESC,id DESC LIMIT ?').all(limit).map(r=>({...r,payload:JSON.parse(r.payload)}));}
  status(){return {health:this.db.prepare('SELECT * FROM betting_watch_health').get()??null,lastScan:this.db.prepare('SELECT * FROM betting_watch_scans ORDER BY id DESC LIMIT 1').get()??null,alerts:this.db.prepare('SELECT status,count(*) count FROM betting_watch_alerts GROUP BY status').all(),observations:this.db.prepare('SELECT count(*) count FROM betting_watch_quotes').get().count};}
}
