CREATE TABLE schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
CREATE TABLE projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    path TEXT UNIQUE NOT NULL,
    description TEXT,
    is_external INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_active DATETIME DEFAULT CURRENT_TIMESTAMP
, status TEXT NOT NULL DEFAULT 'active', archived_at DATETIME, deleted_at DATETIME);
CREATE TABLE global_memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE NOT NULL,
    value TEXT NOT NULL,
    category TEXT DEFAULT 'general',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE user_memory (
    id INTEGER PRIMARY KEY,
    data TEXT NOT NULL DEFAULT '[]',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE project_memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    category TEXT DEFAULT 'general',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, key)
);
CREATE TABLE agents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    type TEXT NOT NULL DEFAULT 'manual',
    config TEXT NOT NULL DEFAULT '{}',
    status TEXT DEFAULT 'idle',
    schedule TEXT,
    last_run DATETIME,
    next_run DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE agent_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    run_id TEXT NOT NULL,
    level TEXT NOT NULL DEFAULT 'info',
    message TEXT NOT NULL,
    data TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE chat_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT UNIQUE NOT NULL,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    title TEXT,
    state TEXT DEFAULT 'active',
    metadata TEXT DEFAULT '{}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    metadata TEXT DEFAULT '{}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE learned_patterns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pattern_hash TEXT UNIQUE NOT NULL,
    pattern_type TEXT NOT NULL DEFAULT 'question',
    trigger_text TEXT NOT NULL,
    response_text TEXT NOT NULL,
    confirm_count INTEGER DEFAULT 1,
    auto_apply INTEGER DEFAULT 0,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE workflow_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT UNIQUE NOT NULL,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    state TEXT NOT NULL DEFAULT 'INIT',
    complexity TEXT DEFAULT 'SIMPLE',
    request TEXT NOT NULL,
    plan TEXT,
    implementation TEXT,
    timing TEXT DEFAULT '{}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE conversations (
    id TEXT PRIMARY KEY,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    title TEXT,
    summary TEXT,
    message_count INTEGER DEFAULT 0,
    state TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
, summary_up_to_msg_id INTEGER DEFAULT NULL, archived_at DATETIME, deleted_at DATETIME, summary_archive TEXT);
CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    tokens INTEGER,
    metadata TEXT DEFAULT '{}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
, archived INTEGER DEFAULT 0);
CREATE TABLE attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type TEXT,
    size INTEGER NOT NULL,
    hash TEXT NOT NULL,
    path TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE drafts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(conversation_id),
    UNIQUE(project_id)
);
CREATE TABLE user_settings (
    id INTEGER PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level TEXT DEFAULT 'info',
    message TEXT,
    data TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE conversation_expertises (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    expertise_id TEXT NOT NULL,
    weight REAL DEFAULT 0.5 CHECK(weight >= 0.1 AND weight <= 1.0),
    position INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(conversation_id, expertise_id)
);
CREATE TABLE merge_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT,
    execution_trace_id TEXT,
    timestamp TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE capability_drift_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT,
    execution_trace_id TEXT,
    expert_id TEXT NOT NULL,
    merged_prompt_hash TEXT,
    expected_profile TEXT NOT NULL,
    observed_scores TEXT NOT NULL,
    drift_score REAL NOT NULL DEFAULT 0,
    violations TEXT,
    execution_step TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
, expertise_id TEXT);
CREATE TABLE llm_execution_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    execution_trace_id TEXT,
    conversation_id TEXT,
    execution_step TEXT NOT NULL DEFAULT 'LLM',
    expert_id TEXT,
    model TEXT,
    temperature REAL,
    prompt_hash TEXT,
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    latency_ms INTEGER,
    token_source TEXT DEFAULT 'estimated',
    metadata TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
, expertise_id TEXT);
CREATE TABLE project_lifecycles (
    id TEXT PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    phase TEXT NOT NULL DEFAULT 'SPEC',
    spec TEXT,
    config TEXT NOT NULL DEFAULT '{}',
    active_session_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE roadmap_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lifecycle_id TEXT NOT NULL REFERENCES project_lifecycles(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    roadmap TEXT NOT NULL,
    change_reason TEXT,
    diff_summary TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(lifecycle_id, version)
);
CREATE TABLE milestones (
    id TEXT PRIMARY KEY,
    lifecycle_id TEXT NOT NULL REFERENCES project_lifecycles(id) ON DELETE CASCADE,
    roadmap_version INTEGER NOT NULL,
    sequence INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING',
    dependencies TEXT DEFAULT '[]',
    estimated_loc INTEGER DEFAULT 0,
    estimated_files INTEGER DEFAULT 0,
    estimated_complexity TEXT DEFAULT 'MEDIUM',
    test_strategy TEXT,
    local_plan TEXT,
    scope_files TEXT,
    workflow_session_id TEXT,
    commit_hash TEXT,
    git_tag TEXT,
    health_score TEXT,
    started_at DATETIME,
    completed_at DATETIME,
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3, checkpoint_mode TEXT DEFAULT 'FUNCTIONAL',
    UNIQUE(lifecycle_id, sequence)
);
CREATE TABLE change_requests (
    id TEXT PRIMARY KEY,
    lifecycle_id TEXT NOT NULL REFERENCES project_lifecycles(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'PROPOSED',
    description TEXT NOT NULL,
    affected_milestones TEXT DEFAULT '[]',
    impact_analysis TEXT,
    proposed_roadmap_diff TEXT,
    old_roadmap_version INTEGER,
    new_roadmap_version INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME
);
CREATE TABLE drift_checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lifecycle_id TEXT NOT NULL REFERENCES project_lifecycles(id) ON DELETE CASCADE,
    milestone_id TEXT REFERENCES milestones(id) ON DELETE SET NULL,
    check_type TEXT NOT NULL,
    result TEXT NOT NULL,
    details TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE lifecycle_handoff_state (
    session_id TEXT PRIMARY KEY,
    phase TEXT NOT NULL,
    lifecycle_id TEXT REFERENCES project_lifecycles(id) ON DELETE CASCADE,
    current_milestone_id TEXT,
    original_request TEXT,
    project_id INTEGER,
    project_path TEXT,
    change_request_id TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE cre_override_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      execution_trace_id TEXT,
      conversation_id TEXT,
      session_id TEXT,
      event_type TEXT NOT NULL DEFAULT 'override',
      source TEXT NOT NULL,
      reason TEXT NOT NULL,
      decision_type TEXT,
      decision_intent TEXT,
      original_type TEXT,
      original_intent TEXT,
      confidence REAL,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
CREATE TABLE knowledge_facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      domain TEXT NOT NULL,
      specialist_id TEXT,
      category TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      value_type TEXT NOT NULL DEFAULT 'number',
      valid_from TEXT,
      valid_to TEXT,
      year INTEGER,
      source TEXT,
      source_url TEXT,
      confidence TEXT NOT NULL DEFAULT 'high',
      is_provisional INTEGER DEFAULT 0,
      verified_at TEXT,
      verified_by TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(domain, category, key, year)
    );
CREATE TABLE knowledge_sources (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      domain TEXT NOT NULL,
      url TEXT,
      affects TEXT NOT NULL DEFAULT '[]',
      keywords TEXT DEFAULT '[]',
      check_frequency_days INTEGER DEFAULT 30,
      last_checked_at DATETIME,
      last_result TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
CREATE TABLE knowledge_verification_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fact_id INTEGER REFERENCES knowledge_facts(id) ON DELETE CASCADE,
      source_id TEXT REFERENCES knowledge_sources(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      triggered_by TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
CREATE TABLE entity_profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      entity_type TEXT NOT NULL DEFAULT 'osvc'
        CHECK (entity_type IN ('osvc', 'sro', 'za')),
      vat_registered INTEGER DEFAULT 0,
      tax_regime TEXT DEFAULT 'actual'
        CHECK (tax_regime IN ('actual', 'flat_expense', 'flat_tax')),
      flat_expense_category TEXT
        CHECK (flat_expense_category IS NULL OR
               flat_expense_category IN ('rate_80', 'rate_60', 'rate_40', 'rate_30')),
      main_or_secondary TEXT DEFAULT 'main'
        CHECK (main_or_secondary IN ('main', 'secondary')),
      children INTEGER DEFAULT 0,
      spouse_credit INTEGER DEFAULT 0,
      rates_version TEXT DEFAULT '2025_v1',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
CREATE TABLE financial_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_id TEXT NOT NULL REFERENCES entity_profiles(id) ON DELETE CASCADE,
      entry_type TEXT NOT NULL
        CHECK (entry_type IN ('income', 'expense', 'tax_payment', 'insurance_payment')),
      amount_cents INTEGER NOT NULL,
      vat_rate REAL,
      vat_amount_cents INTEGER,
      category TEXT NOT NULL,
      description TEXT,
      document_ref TEXT,
      is_tax_deductible INTEGER DEFAULT 1,
      entry_date TEXT NOT NULL,
      period_year INTEGER NOT NULL,
      version INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT,
      deleted_at TEXT
    , supply_date TEXT, partner_dic TEXT, partner_name TEXT, document_number TEXT, vat_type TEXT DEFAULT NULL);
CREATE TABLE entry_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id INTEGER NOT NULL,
      snapshot_json TEXT NOT NULL,
      changed_at TEXT DEFAULT (datetime('now'))
    );
CREATE TABLE calculation_runs (
      id TEXT PRIMARY KEY,
      entity_id TEXT NOT NULL REFERENCES entity_profiles(id) ON DELETE CASCADE,
      year INTEGER NOT NULL,
      rates_version TEXT NOT NULL,
      input_json TEXT NOT NULL,
      result_json TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
CREATE TABLE expertises (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      domain TEXT,
      system_prompt TEXT,
      temperature REAL DEFAULT 0.5 CHECK(temperature >= 0 AND temperature <= 1),
      config TEXT NOT NULL DEFAULT '{}',
      is_builtin INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
CREATE TABLE expertise_bindings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      expertise_id TEXT NOT NULL,
      locked INTEGER DEFAULT 0,
      strength INTEGER DEFAULT 50 CHECK(strength >= 0 AND strength <= 100),
      locked_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(conversation_id)
    );
CREATE TABLE expertise_memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      expertise_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      previous_value TEXT DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(expertise_id, key)
    );
CREATE TABLE custom_expertises (
      id TEXT PRIMARY KEY,
      config TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
CREATE TABLE period_locks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_id TEXT NOT NULL REFERENCES entity_profiles(id) ON DELETE CASCADE,
      year INTEGER NOT NULL,
      locked_at TEXT NOT NULL DEFAULT (datetime('now')),
      locked_by TEXT DEFAULT 'system',
      calculation_run_id TEXT REFERENCES calculation_runs(id),
      notes TEXT,
      UNIQUE(entity_id, year)
    );
CREATE TABLE tax_losses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_id TEXT NOT NULL REFERENCES entity_profiles(id) ON DELETE CASCADE,
      origin_year INTEGER NOT NULL,
      original_amount_cents INTEGER NOT NULL,
      remaining_cents INTEGER NOT NULL,
      expires_year INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(entity_id, origin_year)
    );
CREATE TABLE vat_periods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_id TEXT NOT NULL REFERENCES entity_profiles(id) ON DELETE CASCADE,
      period_type TEXT NOT NULL CHECK (period_type IN ('monthly', 'quarterly')),
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'submitted', 'closed')),
      submitted_at TEXT,
      vat_return_json TEXT,
      control_report_json TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(entity_id, period_start)
    );
CREATE TABLE compliance_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_id TEXT NOT NULL REFERENCES entity_profiles(id) ON DELETE CASCADE,
      rule_code TEXT NOT NULL,
      year INTEGER NOT NULL,
      period TEXT,
      status TEXT NOT NULL CHECK (status IN ('ok', 'warning', 'violation', 'not_applicable')),
      checked_at TEXT DEFAULT (datetime('now')),
      detail_json TEXT,
      UNIQUE(entity_id, rule_code, year, period)
    );
CREATE TABLE specialists (
      id TEXT PRIMARY KEY,
      version TEXT NOT NULL,
      name TEXT NOT NULL,
      domain TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'domain'
        CHECK (type IN ('domain', 'utility', 'integration')),
      status TEXT NOT NULL DEFAULT 'installed'
        CHECK (status IN ('installed', 'enabled', 'disabled')),
      manifest_json TEXT NOT NULL,
      installed_at TEXT DEFAULT (datetime('now')),
      enabled_at TEXT,
      disabled_at TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );
CREATE TABLE specialist_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      specialist_id TEXT NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,
      migration_name TEXT NOT NULL,
      applied_at TEXT DEFAULT (datetime('now')),
      UNIQUE(specialist_id, migration_name)
    );
CREATE TABLE specialist_memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      specialist_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      value_type TEXT NOT NULL DEFAULT 'string',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(specialist_id, conversation_id, key)
    );
CREATE TABLE quality_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lifecycle_id TEXT NOT NULL,
      artifact_type TEXT NOT NULL,
      artifact_version INTEGER,
      score REAL NOT NULL,
      label TEXT NOT NULL,
      breakdown TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (lifecycle_id) REFERENCES project_lifecycles(id)
    );
CREATE TABLE telemetry_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

      turn_id TEXT NOT NULL,
      session_id TEXT,
      conversation_id TEXT,

      intent TEXT,
      classified_by TEXT,
      execution_status TEXT,

      total_turn_time_ms INTEGER,
      classification_time_ms INTEGER,
      execution_time_ms INTEGER,

      retry_count INTEGER DEFAULT 0,
      partial_failure INTEGER DEFAULT 0,
      was_cancelled INTEGER DEFAULT 0,
      circuit_opened INTEGER DEFAULT 0,

      snapshot_json TEXT NOT NULL
    );
CREATE TABLE specialist_telemetry (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      specialist_id TEXT,
      tool_id TEXT,
      duration_ms INTEGER,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
CREATE TABLE telemetry_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      window_start DATETIME NOT NULL,
      window_end DATETIME NOT NULL,
      total_turns INTEGER NOT NULL,
      ambiguous_count INTEGER NOT NULL,
      ask_user_count INTEGER NOT NULL,
      break_count INTEGER NOT NULL,
      override_count INTEGER NOT NULL,
      avg_confidence REAL,
      override_threshold_at_time REAL,
      rule_distribution TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    , aggregation_version INTEGER NOT NULL DEFAULT 1);
CREATE TABLE telemetry_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      alert_type TEXT NOT NULL,
      severity TEXT NOT NULL,
      metric_value REAL NOT NULL,
      baseline_value REAL,
      threshold_at_time REAL,
      message TEXT,
      acknowledged INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
CREATE TABLE telemetry_improvements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parameter TEXT NOT NULL,
      old_value REAL NOT NULL,
      new_value REAL NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'proposed',
      trust_level INTEGER NOT NULL DEFAULT 0,
      auto_applied INTEGER NOT NULL DEFAULT 0,
      rollback_trigger TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      applied_at DATETIME
    );
CREATE TABLE skill_executions (
      id TEXT PRIMARY KEY,
      skill_id TEXT NOT NULL,
      skill_version INTEGER NOT NULL,
      state TEXT NOT NULL DEFAULT 'IDLE',
      input TEXT NOT NULL,
      params TEXT,
      steps_output TEXT,
      confidence REAL,
      current_step_id TEXT,
      error_message TEXT,
      session_id TEXT,
      conversation_id TEXT,
      locked_at DATETIME,
      started_at DATETIME,
      confirmed_at DATETIME,
      completed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
CREATE TABLE skill_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      execution_id TEXT NOT NULL REFERENCES skill_executions(id),
      step_id TEXT NOT NULL,
      step_type TEXT NOT NULL,
      status TEXT NOT NULL,
      error_type TEXT,
      output TEXT,
      output_hash TEXT,
      retryable INTEGER DEFAULT 0,
      retry_count INTEGER DEFAULT 0,
      duration_ms INTEGER,
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
CREATE TABLE memory (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      key TEXT NOT NULL,
      value JSON NOT NULL,
      confidence REAL DEFAULT 1.0,
      source TEXT DEFAULT 'explicit',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_used DATETIME,
      ttl INTEGER, access_count INTEGER DEFAULT 0, last_accessed_at DATETIME,
      UNIQUE(user_id, kind, key)
    );
CREATE TABLE workflow_patterns (
      pattern_hash TEXT PRIMARY KEY,
      tool_sequence TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 1,
      last_seen DATETIME NOT NULL,
      proposed INTEGER NOT NULL DEFAULT 0,
      session_ids TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
CREATE TABLE auto_expertise_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      input_preview TEXT,
      selected_id TEXT,
      confidence REAL,
      scores_json TEXT,
      reason TEXT,
      timestamp INTEGER NOT NULL
    );
CREATE TABLE api_tokens (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      scopes TEXT DEFAULT '[]',
      last_used_at DATETIME,
      expires_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
CREATE TABLE specialist_expertises (
      specialist_id TEXT NOT NULL,
      expertise_id TEXT NOT NULL,
      label TEXT,
      priority INTEGER DEFAULT 0,
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (specialist_id, expertise_id)
    );
CREATE TABLE feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL DEFAULT 'other',
      message TEXT NOT NULL,
      version TEXT,
      context TEXT,
      last_response TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
CREATE TABLE feedback_attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      feedback_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      path TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (feedback_id) REFERENCES feedback(id) ON DELETE CASCADE
    );
CREATE TABLE architecture_state (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lifecycle_id TEXT NOT NULL REFERENCES project_lifecycles(id) ON DELETE CASCADE,
      milestone_id TEXT REFERENCES milestones(id) ON DELETE SET NULL,
      phase TEXT NOT NULL DEFAULT 'post',
      layer_violations INTEGER DEFAULT 0,
      circular_deps INTEGER DEFAULT 0,
      naming_issues INTEGER DEFAULT 0,
      api_surface_count INTEGER DEFAULT 0,
      drift_score REAL DEFAULT 1.0,
      acf_score REAL DEFAULT 1.0,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
CREATE TABLE api_contracts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lifecycle_id TEXT NOT NULL REFERENCES project_lifecycles(id) ON DELETE CASCADE,
      milestone_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      export_name TEXT NOT NULL,
      signature TEXT,
      kind TEXT NOT NULL DEFAULT 'function',
      consumer_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      removed_at DATETIME
    );
CREATE TABLE upgrade_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL,
      from_model TEXT NOT NULL,
      to_model TEXT NOT NULL,
      score REAL,
      action TEXT NOT NULL DEFAULT 'apply',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
CREATE TABLE task_memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      confidence REAL DEFAULT 0.8,
      milestone_id TEXT,
      created_at INTEGER NOT NULL,
      last_accessed_at INTEGER,
      access_count INTEGER DEFAULT 0,
      UNIQUE(project_id, kind, key)
    );
CREATE TABLE upgrade_proposals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL,
      current_model TEXT NOT NULL,
      candidate_model TEXT NOT NULL,
      score REAL NOT NULL,
      current_score REAL,
      improvement REAL,
      score_breakdown TEXT,
      reason TEXT,
      risk_level TEXT DEFAULT 'medium',
      installed INTEGER DEFAULT 0,
      size_gb REAL DEFAULT 0,
      source TEXT DEFAULT 'local',
      status TEXT DEFAULT 'pending',
      catalog_hash TEXT,
      evaluation_version TEXT,
      detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      resolved_at DATETIME,
      cooldown_until DATETIME
    );
CREATE TABLE model_catalog_cache (
      model_name TEXT PRIMARY KEY,
      exists_in_registry INTEGER,
      metadata_json TEXT,
      verified_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
CREATE TABLE model_performance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL,
      model TEXT NOT NULL,
      task_type TEXT NOT NULL,
      success INTEGER NOT NULL,
      iterations INTEGER DEFAULT 1,
      tokens INTEGER DEFAULT 0,
      duration_ms INTEGER DEFAULT 0,
      errors_fixed INTEGER DEFAULT 0,
      errors_remaining INTEGER DEFAULT 0,
      stop_reason TEXT,
      lifecycle_id TEXT,
      milestone_id TEXT,
      detail_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
CREATE TABLE discovered_models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      family TEXT NOT NULL,
      params REAL,
      category TEXT,
      base_vram_mb INTEGER,
      context_window INTEGER,
      benchmarks_json TEXT,
      benchmark_confidence REAL,
      capabilities_json TEXT,
      source TEXT DEFAULT 'L4',
      discovered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    , benchmark_source TEXT DEFAULT NULL);
CREATE TABLE validation_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model TEXT NOT NULL,
      suite TEXT NOT NULL,
      test_name TEXT NOT NULL,
      passed INTEGER NOT NULL,
      score REAL NOT NULL DEFAULT 0.0,
      response_preview TEXT,
      duration_ms INTEGER DEFAULT 0,
      eval_tokens INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
CREATE TABLE validation_suite_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model TEXT NOT NULL,
      suite TEXT NOT NULL,
      score REAL NOT NULL DEFAULT 0.0,
      passed INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER DEFAULT 0,
      validated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
CREATE TABLE marketplace_packages (
      id TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('skill', 'expertise', 'specialist')),
      name TEXT,
      version TEXT,
      author TEXT,
      description TEXT,
      tags TEXT,
      dependencies TEXT,
      download_url TEXT,
      sha256 TEXT,
      catalog_data TEXT,
      installed_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (id, type)
    );
CREATE TABLE marketplace_catalog_cache (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      catalog_json TEXT NOT NULL,
      fetched_at TEXT DEFAULT (datetime('now')),
      etag TEXT
    );
CREATE TABLE media_generations (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('txt2img','img2img','txt2vid')),
      prompt TEXT NOT NULL,
      negative_prompt TEXT DEFAULT '',
      params TEXT NOT NULL,
      workflow_template TEXT,
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed','cancelled')),
      comfyui_prompt_id TEXT,
      outputs TEXT,
      error TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT,
      duration_ms INTEGER,
      favorite INTEGER DEFAULT 0
    );
CREATE TABLE model_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model TEXT NOT NULL,
      role TEXT NOT NULL,
      used_at TEXT DEFAULT (datetime('now')),
      request_type TEXT
    );
CREATE TABLE governor_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      overall_health TEXT NOT NULL,
      overall_score REAL NOT NULL,
      dimensions TEXT NOT NULL,
      proposals_json TEXT NOT NULL,
      summary TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
CREATE TABLE governor_proposals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id INTEGER NOT NULL REFERENCES governor_reports(id),
      rule_id TEXT NOT NULL,
      type TEXT NOT NULL,
      severity TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      suggested_action TEXT,
      action_payload TEXT,
      confidence REAL NOT NULL,
      priority REAL NOT NULL,
      root_cause TEXT,
      hash TEXT NOT NULL,
      cooldown_until DATETIME,
      status TEXT NOT NULL DEFAULT 'pending',
      resolved_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
CREATE TABLE model_universe_raw (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_name TEXT NOT NULL,
      tag TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'local',
      write_source TEXT NOT NULL DEFAULT 'universe',
      write_token TEXT,
      idempotency_key TEXT,
      idempotency_expires_at DATETIME,
      metadata_state TEXT NOT NULL DEFAULT 'PARTIAL',
      parameters REAL,
      context_length INTEGER,
      quantization TEXT,
      modality TEXT,
      metadata_json TEXT,
      last_verified_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(model_name, tag, source)
    );
CREATE TABLE model_universe_derived (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_name TEXT NOT NULL,
      tag TEXT NOT NULL DEFAULT '',
      score_estimated REAL,
      confidence REAL,
      confidence_state TEXT DEFAULT 'LOW',
      score_state TEXT DEFAULT 'estimated',
      capability_vector_json TEXT,
      recompute_at DATETIME,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, based_on_version TEXT, last_computed_at DATETIME,
      UNIQUE(model_name, tag)
    );
CREATE TABLE model_signal_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_name TEXT NOT NULL,
      role TEXT,
      signal_type TEXT NOT NULL,
      success INTEGER,
      latency_ms INTEGER,
      error_type TEXT,
      payload_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
CREATE TABLE registry_delta (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_key TEXT NOT NULL,
      delta_json TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME
    );
CREATE TABLE model_reconciliation_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_name TEXT NOT NULL,
      tag TEXT NOT NULL DEFAULT '',
      field TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      source TEXT NOT NULL,
      confidence REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    , reason_code TEXT, effective_priority REAL);
CREATE TABLE model_write_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_name TEXT NOT NULL,
      tag TEXT NOT NULL DEFAULT '',
      write_token TEXT,
      write_source TEXT NOT NULL,
      status TEXT NOT NULL,
      error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
CREATE TABLE model_runtime_guard (
      model_name TEXT PRIMARY KEY,
      state TEXT NOT NULL DEFAULT 'enabled',
      error_rate REAL,
      sample_size INTEGER,
      window_seconds INTEGER,
      disabled_until DATETIME,
      reason TEXT,
      last_event_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
CREATE TABLE notification_log_v57 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT,
      channel TEXT NOT NULL,
      recipient TEXT,
      title TEXT,
      priority TEXT DEFAULT 'normal',
      delivered INTEGER NOT NULL DEFAULT 0,
      policy_decision TEXT,
      error TEXT,
      context_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    , useful INTEGER DEFAULT NULL, feedback_at TEXT DEFAULT NULL);
CREATE TABLE notification_channels_v57 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      recipient TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      config TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(agent_id, channel)
    );
CREATE TABLE notification_state_v57 (
      agent_id TEXT PRIMARY KEY,
      muted_until TEXT,
      last_sent_at TEXT,
      last_effective_priority TEXT,
      last_body_hash TEXT,
      escalation_counter INTEGER DEFAULT 0,
      escalation_window_start TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    , auto_mute_reason TEXT DEFAULT NULL);
CREATE TABLE notification_digest_buffer_v57 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      recipient TEXT,
      title TEXT,
      body TEXT,
      priority TEXT DEFAULT 'normal',
      context_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
CREATE TABLE agents_v33 (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      icon TEXT DEFAULT '🤖',
      definition TEXT NOT NULL,
      state TEXT DEFAULT '{}',
      params TEXT DEFAULT '{}',
      enabled INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
CREATE TABLE agent_runs_v33 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      finished_at DATETIME,
      status TEXT DEFAULT 'running',
      triggers_fired TEXT DEFAULT '[]',
      actions_executed INTEGER DEFAULT 0,
      explain TEXT,
      log TEXT,
      error TEXT,
      FOREIGN KEY (agent_id) REFERENCES agents_v33(id) ON DELETE CASCADE
    );
CREATE TABLE agent_notifications_v33 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      run_id INTEGER,
      title TEXT NOT NULL,
      body TEXT,
      priority TEXT DEFAULT 'normal',
      data TEXT,
      read_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (agent_id) REFERENCES agents_v33(id) ON DELETE CASCADE,
      FOREIGN KEY (run_id) REFERENCES agent_runs_v33(id) ON DELETE SET NULL
    );
CREATE TABLE agent_data_v33 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(agent_id, key),
      FOREIGN KEY (agent_id) REFERENCES agents_v33(id) ON DELETE CASCADE
    );
CREATE TABLE agent_schedule_v33 (
      agent_id TEXT PRIMARY KEY,
      next_run DATETIME,
      last_run DATETIME,
      interval_ms INTEGER,
      cron_expression TEXT,
      FOREIGN KEY (agent_id) REFERENCES agents_v33(id) ON DELETE CASCADE
    );
CREATE TABLE agent_drafts_v33 (
      id TEXT PRIMARY KEY,
      definition TEXT NOT NULL,
      params TEXT DEFAULT '{}',
      explanation TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME
    );
CREATE TABLE user_inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT,
      brand TEXT,
      model TEXT,
      purchase_date DATE,
      warranty_months INTEGER,
      warranty_end DATE,
      notes TEXT,
      metadata TEXT DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
CREATE TABLE agent_seen_items_v57 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      item_hash TEXT,
      seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(agent_id, source_id, item_id),
      FOREIGN KEY (agent_id) REFERENCES agents_v33(id) ON DELETE CASCADE
    );
CREATE TABLE session_state (
            session_id TEXT PRIMARY KEY,
            state_json TEXT NOT NULL,
            updated_at INTEGER NOT NULL
          );
CREATE TABLE event_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT NOT NULL DEFAULT 'info'
        CHECK (level IN ('debug', 'info', 'warn', 'error')),
      source TEXT NOT NULL DEFAULT 'system',
      message TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
CREATE TABLE notification_trust_actions_v57 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        action TEXT NOT NULL,
        reason TEXT,
        metrics_snapshot TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
CREATE TABLE model_failover_proofs (
      proof_id TEXT PRIMARY KEY
        CHECK (length(trim(proof_id)) BETWEEN 16 AND 128),
      validation_run_id TEXT NOT NULL
        CHECK (length(trim(validation_run_id)) BETWEEN 1 AND 128),
      role TEXT NOT NULL CHECK (role IN ('D1','D2','CODE','R1','R2','CHAT','VISION')),
      suite TEXT NOT NULL CHECK (suite IN ('reasoning','code','chat','vision','review')),
      role_contract_sha256 TEXT NOT NULL
        CHECK (
          length(role_contract_sha256) = 64
          AND role_contract_sha256 = lower(role_contract_sha256)
          AND role_contract_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
      model_name TEXT NOT NULL
        CHECK (length(trim(model_name)) BETWEEN 1 AND 512),
      model_canonical_name TEXT NOT NULL
        CHECK (length(trim(model_canonical_name)) BETWEEN 1 AND 512),
      model_digest_sha256 TEXT NOT NULL
        CHECK (
          length(model_digest_sha256) = 64
          AND model_digest_sha256 = lower(model_digest_sha256)
          AND model_digest_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
      validation_version TEXT NOT NULL
        CHECK (length(trim(validation_version)) BETWEEN 1 AND 64),
      policy_version TEXT NOT NULL
        CHECK (length(trim(policy_version)) BETWEEN 1 AND 64),
      score REAL NOT NULL CHECK (score >= 0 AND score <= 1),
      required_score REAL NOT NULL CHECK (required_score > 0 AND required_score <= 1),
      passed_count INTEGER NOT NULL
        CHECK (typeof(passed_count) = 'integer' AND passed_count >= 0),
      required_passed_count INTEGER NOT NULL
        CHECK (typeof(required_passed_count) = 'integer' AND required_passed_count >= 1),
      total_count INTEGER NOT NULL
        CHECK (typeof(total_count) = 'integer' AND total_count > 0),
      duration_ms INTEGER NOT NULL
        CHECK (typeof(duration_ms) = 'integer' AND duration_ms >= 0),
      result TEXT NOT NULL CHECK (result = 'PASS'),
      inventory_before_name TEXT NOT NULL
        CHECK (length(trim(inventory_before_name)) BETWEEN 1 AND 512),
      inventory_before_digest TEXT NOT NULL,
      inventory_after_name TEXT NOT NULL
        CHECK (length(trim(inventory_after_name)) BETWEEN 1 AND 512),
      inventory_after_digest TEXT NOT NULL,
      started_at_ms INTEGER NOT NULL
        CHECK (typeof(started_at_ms) = 'integer' AND started_at_ms > 0),
      completed_at_ms INTEGER NOT NULL
        CHECK (typeof(completed_at_ms) = 'integer' AND completed_at_ms >= started_at_ms),
      expires_at_ms INTEGER NOT NULL
        CHECK (typeof(expires_at_ms) = 'integer' AND expires_at_ms > completed_at_ms),
      created_at_ms INTEGER NOT NULL
        CHECK (typeof(created_at_ms) = 'integer' AND created_at_ms > 0), measurement_artifact_sha256 TEXT, acceptance_artifact_sha256 TEXT, source_revision TEXT,

      UNIQUE(validation_run_id, role),
      CHECK (
        (role IN ('D1','D2','R1') AND suite = 'reasoning')
        OR (role = 'CODE' AND suite = 'code')
        OR (role = 'R2' AND suite = 'review')
        OR (role = 'CHAT' AND suite = 'chat')
        OR (role = 'VISION' AND suite = 'vision')
      ),
      CHECK (passed_count <= total_count),
      CHECK (required_passed_count <= total_count),
      CHECK (score >= required_score),
      CHECK (passed_count >= required_passed_count),
      CHECK (inventory_before_digest = model_digest_sha256),
      CHECK (inventory_after_digest = model_digest_sha256),
      CHECK (created_at_ms >= completed_at_ms)
    );
CREATE TABLE model_failover_events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE
        CHECK (length(trim(event_id)) BETWEEN 1 AND 128),
      event_type TEXT NOT NULL CHECK (event_type IN (
  'DESIRED_OBSERVED','DESIRED_CHANGED','DETECTED',
  'ACTIVATION_CLAIMED','ACTIVATED','ACTIVATION_FAILED',
  'RESTORE_CLAIMED','RESTORED','RESTORE_FAILED',
  'REAPPLY_CLAIMED','REAPPLIED','REAPPLY_FAILED',
  'CLAIM_EXPIRED','SUPERSEDED_BY_USER'
)),
      role TEXT NOT NULL CHECK (role IN ('D1','D2','CODE','R1','R2','CHAT','VISION')),
      binding_revision INTEGER NOT NULL
        CHECK (typeof(binding_revision) = 'integer' AND binding_revision >= 1),
      row_version INTEGER
        CHECK (row_version IS NULL OR (typeof(row_version) = 'integer' AND row_version >= 1)),
      episode_id TEXT
        CHECK (episode_id IS NULL OR length(trim(episode_id)) BETWEEN 1 AND 128),
      operation_id TEXT
        CHECK (operation_id IS NULL OR length(trim(operation_id)) BETWEEN 1 AND 128),
      actor TEXT NOT NULL
        CHECK (length(trim(actor)) BETWEEN 1 AND 128),
      reason_code TEXT NOT NULL
        CHECK (length(trim(reason_code)) BETWEEN 1 AND 128),
      policy_version TEXT NOT NULL
        CHECK (length(trim(policy_version)) BETWEEN 1 AND 64),
      state_before TEXT CHECK (state_before IS NULL OR state_before IN ('DETECTED','ACTIVATED','FAILED','RESTORED','SUPERSEDED_BY_USER')),
      state_after TEXT CHECK (state_after IS NULL OR state_after IN ('DETECTED','ACTIVATED','FAILED','RESTORED','SUPERSEDED_BY_USER')),
      desired_model_name TEXT
        CHECK (desired_model_name IS NULL OR length(trim(desired_model_name)) BETWEEN 1 AND 512),
      desired_digest_sha256 TEXT
        CHECK (
          desired_digest_sha256 IS NULL OR (
            length(desired_digest_sha256) = 64
            AND desired_digest_sha256 = lower(desired_digest_sha256)
            AND desired_digest_sha256 NOT GLOB '*[^0-9a-f]*'
          )
        ),
      fallback_model_name TEXT
        CHECK (fallback_model_name IS NULL OR length(trim(fallback_model_name)) BETWEEN 1 AND 512),
      fallback_canonical_name TEXT
        CHECK (fallback_canonical_name IS NULL OR length(trim(fallback_canonical_name)) BETWEEN 1 AND 512),
      fallback_digest_sha256 TEXT
        CHECK (
          fallback_digest_sha256 IS NULL OR (
            length(fallback_digest_sha256) = 64
            AND fallback_digest_sha256 = lower(fallback_digest_sha256)
            AND fallback_digest_sha256 NOT GLOB '*[^0-9a-f]*'
          )
        ),
      proof_id TEXT REFERENCES model_failover_proofs(proof_id) ON DELETE RESTRICT,
      verified INTEGER NOT NULL DEFAULT 0
        CHECK (typeof(verified) = 'integer' AND verified IN (0, 1)),
      failure_phase TEXT
        CHECK (failure_phase IS NULL OR failure_phase IN ('VERIFICATION','PERSISTENCE','RUNTIME_APPLY','RESTORE','REHYDRATE')),
      details_json TEXT NOT NULL DEFAULT '{}'
        CHECK (json_valid(details_json) AND json_type(details_json) = 'object'),
      created_at_ms INTEGER NOT NULL
        CHECK (typeof(created_at_ms) = 'integer' AND created_at_ms > 0),

      CHECK ((desired_model_name IS NULL) = (desired_digest_sha256 IS NULL)),
      CHECK (
        (fallback_model_name IS NULL AND fallback_canonical_name IS NULL AND fallback_digest_sha256 IS NULL)
        OR
        (fallback_model_name IS NOT NULL AND fallback_canonical_name IS NOT NULL AND fallback_digest_sha256 IS NOT NULL)
      ),
      CHECK (verified = 0 OR proof_id IS NOT NULL),
      CHECK (
        event_type NOT IN ('ACTIVATED','RESTORED','REAPPLIED')
        OR (verified = 1 AND proof_id IS NOT NULL)
      ),
      CHECK (
        (event_type IN ('ACTIVATION_FAILED','RESTORE_FAILED','REAPPLY_FAILED'))
        = (failure_phase IS NOT NULL)
      )
    );
CREATE TABLE model_desired_bindings (
      role TEXT PRIMARY KEY CHECK (role IN ('D1','D2','CODE','R1','R2','CHAT','VISION')),
      model_name TEXT NOT NULL
        CHECK (length(trim(model_name)) BETWEEN 1 AND 512),
      canonical_name TEXT NOT NULL
        CHECK (length(trim(canonical_name)) BETWEEN 1 AND 512),
      digest_sha256 TEXT NOT NULL
        CHECK (
          length(digest_sha256) = 64
          AND digest_sha256 = lower(digest_sha256)
          AND digest_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
      binding_revision INTEGER NOT NULL
        CHECK (typeof(binding_revision) = 'integer' AND binding_revision >= 1),
      source TEXT NOT NULL CHECK (source IN (
        'CONFIG_DEFAULT','LEGACY_OVERRIDE','USER_APPLY','USER_ROLLBACK'
      )),
      actor TEXT NOT NULL
        CHECK (length(trim(actor)) BETWEEN 1 AND 128),
      observed_at_ms INTEGER NOT NULL
        CHECK (typeof(observed_at_ms) = 'integer' AND observed_at_ms > 0),
      updated_at_ms INTEGER NOT NULL
        CHECK (typeof(updated_at_ms) = 'integer' AND updated_at_ms >= observed_at_ms),
      last_event_id TEXT NOT NULL
        REFERENCES model_failover_events(event_id) ON DELETE RESTRICT,

      UNIQUE(role, binding_revision)
    );
CREATE TABLE model_failover_state (
      role TEXT PRIMARY KEY CHECK (role IN ('D1','D2','CODE','R1','R2','CHAT','VISION')),
      desired_revision INTEGER NOT NULL
        CHECK (typeof(desired_revision) = 'integer' AND desired_revision >= 1),
      episode_id TEXT NOT NULL UNIQUE
        CHECK (length(trim(episode_id)) BETWEEN 1 AND 128),
      state TEXT NOT NULL CHECK (state IN ('DETECTED','ACTIVATED','FAILED','RESTORED','SUPERSEDED_BY_USER')),
      active_failover INTEGER NOT NULL
        CHECK (typeof(active_failover) = 'integer' AND active_failover IN (0, 1)),
      fallback_model_name TEXT
        CHECK (fallback_model_name IS NULL OR length(trim(fallback_model_name)) BETWEEN 1 AND 512),
      fallback_canonical_name TEXT
        CHECK (fallback_canonical_name IS NULL OR length(trim(fallback_canonical_name)) BETWEEN 1 AND 512),
      fallback_digest_sha256 TEXT
        CHECK (
          fallback_digest_sha256 IS NULL OR (
            length(fallback_digest_sha256) = 64
            AND fallback_digest_sha256 = lower(fallback_digest_sha256)
            AND fallback_digest_sha256 NOT GLOB '*[^0-9a-f]*'
          )
        ),
      proof_id TEXT REFERENCES model_failover_proofs(proof_id) ON DELETE RESTRICT,
      active_event_id TEXT
        REFERENCES model_failover_events(event_id) ON DELETE RESTRICT,
      policy_version TEXT NOT NULL
        CHECK (length(trim(policy_version)) BETWEEN 1 AND 64),
      actor TEXT NOT NULL
        CHECK (length(trim(actor)) BETWEEN 1 AND 128),
      reason_code TEXT NOT NULL
        CHECK (length(trim(reason_code)) BETWEEN 1 AND 128),
      failure_phase TEXT
        CHECK (failure_phase IS NULL OR failure_phase IN ('VERIFICATION','PERSISTENCE','RUNTIME_APPLY','RESTORE','REHYDRATE')),
      proof_verified_at_ms INTEGER
        CHECK (
          proof_verified_at_ms IS NULL
          OR (typeof(proof_verified_at_ms) = 'integer' AND proof_verified_at_ms > 0)
        ),
      row_version INTEGER NOT NULL DEFAULT 1
        CHECK (typeof(row_version) = 'integer' AND row_version >= 1),
      claim_operation_id TEXT UNIQUE
        CHECK (claim_operation_id IS NULL OR length(trim(claim_operation_id)) BETWEEN 1 AND 128),
      claim_token TEXT UNIQUE
        CHECK (claim_token IS NULL OR length(trim(claim_token)) BETWEEN 16 AND 128),
      claim_kind TEXT CHECK (claim_kind IS NULL OR claim_kind IN ('ACTIVATE','RESTORE','REAPPLY')),
      claim_started_at_ms INTEGER,
      claim_expires_at_ms INTEGER,
      detected_at_ms INTEGER NOT NULL
        CHECK (typeof(detected_at_ms) = 'integer' AND detected_at_ms > 0),
      activated_at_ms INTEGER,
      resolved_at_ms INTEGER,
      updated_at_ms INTEGER NOT NULL
        CHECK (typeof(updated_at_ms) = 'integer' AND updated_at_ms >= detected_at_ms),
      last_event_id TEXT NOT NULL
        REFERENCES model_failover_events(event_id) ON DELETE RESTRICT,

      FOREIGN KEY(role, desired_revision)
        REFERENCES model_desired_bindings(role, binding_revision)
        ON UPDATE RESTRICT ON DELETE RESTRICT
        DEFERRABLE INITIALLY DEFERRED,
      CHECK (
        (fallback_model_name IS NULL AND fallback_canonical_name IS NULL AND fallback_digest_sha256 IS NULL)
        OR
        (fallback_model_name IS NOT NULL AND fallback_canonical_name IS NOT NULL AND fallback_digest_sha256 IS NOT NULL)
      ),
      CHECK (
        active_failover = 0
        OR (
          fallback_model_name IS NOT NULL
          AND proof_id IS NOT NULL
          AND active_event_id IS NOT NULL
          AND proof_verified_at_ms IS NOT NULL
          AND activated_at_ms IS NOT NULL
        )
      ),
      CHECK (state <> 'DETECTED' OR active_failover = 0),
      CHECK (state <> 'ACTIVATED' OR active_failover = 1),
      CHECK (
        state NOT IN ('RESTORED','SUPERSEDED_BY_USER')
        OR (active_failover = 0 AND resolved_at_ms IS NOT NULL)
      ),
      CHECK ((state = 'FAILED') = (failure_phase IS NOT NULL)),
      CHECK (
        (claim_token IS NULL AND claim_operation_id IS NULL AND claim_kind IS NULL
          AND claim_started_at_ms IS NULL AND claim_expires_at_ms IS NULL)
        OR
        (claim_token IS NOT NULL AND claim_operation_id IS NOT NULL AND claim_kind IS NOT NULL
          AND typeof(claim_started_at_ms) = 'integer'
          AND typeof(claim_expires_at_ms) = 'integer'
          AND claim_started_at_ms > 0
          AND claim_expires_at_ms > claim_started_at_ms)
      )
    );
CREATE TABLE model_binding_operations (
      operation_id TEXT PRIMARY KEY
        CHECK (length(trim(operation_id)) BETWEEN 16 AND 128),
      request_key TEXT NOT NULL UNIQUE
        CHECK (length(trim(request_key)) BETWEEN 16 AND 128),
      role TEXT NOT NULL CHECK (role IN ('D1','D2','CODE','R1','R2','CHAT','VISION')),
      operation_kind TEXT NOT NULL
        CHECK (operation_kind IN ('USER_APPLY','USER_ROLLBACK')),
      expected_binding_revision INTEGER NOT NULL
        CHECK (
          typeof(expected_binding_revision) = 'integer'
          AND expected_binding_revision >= 1
        ),
      committed_binding_revision INTEGER NOT NULL
        CHECK (
          typeof(committed_binding_revision) = 'integer'
          AND committed_binding_revision = expected_binding_revision + 1
        ),
      previous_model_name TEXT NOT NULL
        CHECK (length(trim(previous_model_name)) BETWEEN 1 AND 512),
      previous_canonical_name TEXT NOT NULL
        CHECK (length(trim(previous_canonical_name)) BETWEEN 1 AND 512),
      previous_digest_sha256 TEXT NOT NULL
        CHECK (
          length(previous_digest_sha256) = 64
          AND previous_digest_sha256 = lower(previous_digest_sha256)
          AND previous_digest_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
      target_model_name TEXT NOT NULL
        CHECK (length(trim(target_model_name)) BETWEEN 1 AND 512),
      target_canonical_name TEXT NOT NULL
        CHECK (length(trim(target_canonical_name)) BETWEEN 1 AND 512),
      target_digest_sha256 TEXT NOT NULL
        CHECK (
          length(target_digest_sha256) = 64
          AND target_digest_sha256 = lower(target_digest_sha256)
          AND target_digest_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
      predecessor_operation_id TEXT
        REFERENCES model_binding_operations(operation_id) ON DELETE RESTRICT,
      rollback_of_operation_id TEXT
        REFERENCES model_binding_operations(operation_id) ON DELETE RESTRICT,
      verification_status TEXT NOT NULL DEFAULT 'NOT_VERIFIED'
        CHECK (verification_status = 'NOT_VERIFIED'),
      runtime_status TEXT NOT NULL DEFAULT 'NOT_APPLIED'
        CHECK (runtime_status = 'NOT_APPLIED'),
      desired_event_id TEXT NOT NULL UNIQUE
        REFERENCES model_failover_events(event_id) ON DELETE RESTRICT,
      actor TEXT NOT NULL
        CHECK (length(trim(actor)) BETWEEN 1 AND 128),
      reason_code TEXT NOT NULL
        CHECK (length(trim(reason_code)) BETWEEN 1 AND 128),
      policy_version TEXT NOT NULL
        CHECK (length(trim(policy_version)) BETWEEN 1 AND 64),
      details_json TEXT NOT NULL DEFAULT '{}'
        CHECK (json_valid(details_json) AND json_type(details_json) = 'object'),
      created_at_ms INTEGER NOT NULL
        CHECK (typeof(created_at_ms) = 'integer' AND created_at_ms > 0),

      UNIQUE(role, committed_binding_revision),
      CHECK (predecessor_operation_id IS NULL OR predecessor_operation_id <> operation_id),
      CHECK (rollback_of_operation_id IS NULL OR rollback_of_operation_id <> operation_id),
      CHECK (
        previous_model_name <> target_model_name
        OR previous_canonical_name <> target_canonical_name
        OR previous_digest_sha256 <> target_digest_sha256
      ),
      CHECK (
        (operation_kind = 'USER_APPLY' AND rollback_of_operation_id IS NULL)
        OR
        (operation_kind = 'USER_ROLLBACK'
          AND rollback_of_operation_id IS NOT NULL
          AND predecessor_operation_id = rollback_of_operation_id)
      )
    );
CREATE TABLE model_binding_application_attempts (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      operation_id TEXT NOT NULL
        REFERENCES model_binding_operations(operation_id) ON DELETE RESTRICT,
      attempt_revision INTEGER NOT NULL
        CHECK (typeof(attempt_revision) = 'integer' AND attempt_revision >= 1),
      attempt_kind TEXT NOT NULL
        CHECK (attempt_kind IN (
          'RUNTIME_APPLY','STARTUP_REHYDRATE','VERIFICATION','NOTIFICATION'
        )),
      outcome TEXT NOT NULL CHECK (outcome IN ('SUCCEEDED','FAILED')),
      observed_model_name TEXT
        CHECK (
          observed_model_name IS NULL
          OR length(trim(observed_model_name)) BETWEEN 1 AND 512
        ),
      observed_canonical_name TEXT
        CHECK (
          observed_canonical_name IS NULL
          OR length(trim(observed_canonical_name)) BETWEEN 1 AND 512
        ),
      observed_digest_sha256 TEXT
        CHECK (
          observed_digest_sha256 IS NULL OR (
            length(observed_digest_sha256) = 64
            AND observed_digest_sha256 = lower(observed_digest_sha256)
            AND observed_digest_sha256 NOT GLOB '*[^0-9a-f]*'
          )
        ),
      verification_method TEXT
        CHECK (
          verification_method IS NULL
          OR length(trim(verification_method)) BETWEEN 1 AND 64
        ),
      failure_code TEXT
        CHECK (
          failure_code IS NULL
          OR (
            length(failure_code) BETWEEN 3 AND 96
            AND failure_code = upper(failure_code)
            AND failure_code NOT GLOB '*[^A-Z0-9_]*'
          )
        ),
      retryable INTEGER NOT NULL DEFAULT 0
        CHECK (typeof(retryable) = 'integer' AND retryable IN (0, 1)),
      created_at_ms INTEGER NOT NULL
        CHECK (typeof(created_at_ms) = 'integer' AND created_at_ms > 0), runtime_changed INTEGER NOT NULL DEFAULT 0
      CHECK (typeof(runtime_changed) = 'integer' AND runtime_changed IN (0, 1)),

      UNIQUE(operation_id, attempt_revision),
      CHECK (
        (observed_model_name IS NULL
          AND observed_canonical_name IS NULL
          AND observed_digest_sha256 IS NULL)
        OR
        (observed_model_name IS NOT NULL
          AND observed_canonical_name IS NOT NULL
          AND observed_digest_sha256 IS NOT NULL)
      ),
      CHECK (
        (outcome = 'SUCCEEDED'
          AND observed_model_name IS NOT NULL
          AND failure_code IS NULL
          AND retryable = 0)
        OR
        (outcome = 'FAILED' AND failure_code IS NOT NULL)
      ),
      CHECK (
        (attempt_kind = 'VERIFICATION'
          AND verification_method = 'OLLAMA_CHAT_EXACT_DIGEST_V1')
        OR
        (attempt_kind <> 'VERIFICATION' AND verification_method IS NULL)
      ),
      CHECK (
        observed_model_name IS NULL
        OR observed_model_name = observed_canonical_name
        OR observed_model_name = observed_canonical_name || ':latest'
      )
    );
CREATE TABLE model_overrides (
      role TEXT PRIMARY KEY,
      model TEXT NOT NULL,
      previous_model TEXT NOT NULL,
      score REAL,
      applied_by TEXT DEFAULT 'user',
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      verified INTEGER NOT NULL DEFAULT 0
        CHECK (typeof(verified) = 'integer' AND verified IN (0, 1)),
      binding_operation_id TEXT
        REFERENCES model_binding_operations(operation_id) ON DELETE RESTRICT,
      model_canonical_name TEXT,
      model_digest_sha256 TEXT,
      verification_status TEXT NOT NULL DEFAULT 'LEGACY_UNVERIFIED'
        CHECK (verification_status IN (
          'LEGACY_UNVERIFIED','PENDING','VERIFIED','FAILED'
        )),
      CHECK (
        (binding_operation_id IS NULL
          AND model_canonical_name IS NULL
          AND model_digest_sha256 IS NULL
          AND verification_status = 'LEGACY_UNVERIFIED'
          AND verified = 0)
        OR
        (binding_operation_id IS NOT NULL
          AND length(trim(model_canonical_name)) BETWEEN 1 AND 512
          AND length(model_digest_sha256) = 64
          AND model_digest_sha256 = lower(model_digest_sha256)
          AND model_digest_sha256 NOT GLOB '*[^0-9a-f]*'
          AND verification_status IN ('PENDING','VERIFIED','FAILED')
          AND verified = (verification_status = 'VERIFIED'))
      )
    );
CREATE TABLE model_binding_provider_operations (
      command_seq INTEGER PRIMARY KEY AUTOINCREMENT
        CHECK (typeof(command_seq) = 'integer' AND command_seq > 0),
      operation_id TEXT NOT NULL UNIQUE
        CHECK (length(trim(operation_id)) BETWEEN 16 AND 256),
      request_key TEXT NOT NULL UNIQUE
        CHECK (length(trim(request_key)) BETWEEN 16 AND 128),
      role TEXT NOT NULL
        CHECK (role IN ('D1','D2','CODE','R1','R2','CHAT','VISION')),
      effect_kind TEXT NOT NULL CHECK (effect_kind = 'PULL'),
      request_purpose TEXT NOT NULL
        CHECK (request_purpose IN ('USER_APPLY_TARGET','LEGACY_BASELINE_RECOVERY')),
      expected_binding_revision INTEGER
        CHECK (
          (request_purpose = 'USER_APPLY_TARGET'
            AND typeof(expected_binding_revision) = 'integer'
            AND expected_binding_revision >= 1)
          OR
          (request_purpose = 'LEGACY_BASELINE_RECOVERY'
            AND expected_binding_revision IS NULL)
        ),
      provider_origin TEXT NOT NULL
        CHECK (
          provider_origin IN (
            'http://127.0.0.1','http://localhost','http://[::1]'
          )
          OR (
            substr(provider_origin, 1, 17) IN ('http://127.0.0.1:','http://localhost:')
            AND length(substr(provider_origin, 18)) BETWEEN 1 AND 5
            AND substr(provider_origin, 18) NOT GLOB '*[^0-9]*'
            AND CAST(substr(provider_origin, 18) AS INTEGER) BETWEEN 1 AND 65535
            AND CAST(substr(provider_origin, 18) AS TEXT)
              = CAST(CAST(substr(provider_origin, 18) AS INTEGER) AS TEXT)
            AND CAST(substr(provider_origin, 18) AS INTEGER) <> 80
          )
          OR (
            substr(provider_origin, 1, 13) = 'http://[::1]:'
            AND length(substr(provider_origin, 14)) BETWEEN 1 AND 5
            AND substr(provider_origin, 14) NOT GLOB '*[^0-9]*'
            AND CAST(substr(provider_origin, 14) AS INTEGER) BETWEEN 1 AND 65535
            AND CAST(substr(provider_origin, 14) AS TEXT)
              = CAST(CAST(substr(provider_origin, 14) AS INTEGER) AS TEXT)
            AND CAST(substr(provider_origin, 14) AS INTEGER) <> 80
          )
        ),
      requested_model_name TEXT NOT NULL
        CHECK (length(trim(requested_model_name)) BETWEEN 1 AND 512),
      requested_canonical_name TEXT NOT NULL
        CHECK (length(trim(requested_canonical_name)) BETWEEN 1 AND 512),
      actor TEXT NOT NULL
        CHECK (length(trim(actor)) BETWEEN 3 AND 128),
      initial_claim_token TEXT NOT NULL UNIQUE
        CHECK (length(trim(initial_claim_token)) BETWEEN 16 AND 256),
      initial_claim_expires_at_ms INTEGER NOT NULL
        CHECK (typeof(initial_claim_expires_at_ms) = 'integer'),
      created_at_ms INTEGER NOT NULL
        CHECK (typeof(created_at_ms) = 'integer' AND created_at_ms > 0),
      CHECK (
        initial_claim_expires_at_ms > created_at_ms
        AND initial_claim_expires_at_ms <= created_at_ms + 300000
      ),
      CHECK (
        lower(requested_model_name) = requested_canonical_name
        OR lower(requested_model_name) = requested_canonical_name || ':latest'
      )
    );
CREATE TABLE model_binding_provider_attempts (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      operation_id TEXT NOT NULL
        REFERENCES model_binding_provider_operations(operation_id) ON DELETE RESTRICT,
      attempt_revision INTEGER NOT NULL
        CHECK (typeof(attempt_revision) = 'integer' AND attempt_revision = 1),
      outcome TEXT NOT NULL CHECK (outcome IN (
        'SUCCEEDED','FAILED','RECONCILED_PRESENT','RECONCILED_ABSENT'
      )),
      observed_model_name TEXT,
      observed_canonical_name TEXT,
      observed_digest_sha256 TEXT,
      failure_code TEXT,
      retryable INTEGER NOT NULL DEFAULT 0
        CHECK (typeof(retryable) = 'integer' AND retryable IN (0, 1)),
      claim_token TEXT NOT NULL
        CHECK (length(trim(claim_token)) BETWEEN 16 AND 256),
      fencing_revision INTEGER NOT NULL
        CHECK (typeof(fencing_revision) = 'integer' AND fencing_revision >= 1),
      created_at_ms INTEGER NOT NULL
        CHECK (typeof(created_at_ms) = 'integer' AND created_at_ms > 0),
      UNIQUE(operation_id, attempt_revision),
      CHECK (
        (outcome IN ('SUCCEEDED','RECONCILED_PRESENT')
          AND length(trim(observed_model_name)) BETWEEN 1 AND 512
          AND length(trim(observed_canonical_name)) BETWEEN 1 AND 512
          AND length(observed_digest_sha256) = 64
          AND observed_digest_sha256 = lower(observed_digest_sha256)
          AND observed_digest_sha256 NOT GLOB '*[^0-9a-f]*'
          AND failure_code IS NULL
          AND retryable = 0)
        OR
        (outcome = 'FAILED'
          AND observed_model_name IS NULL
          AND observed_canonical_name IS NULL
          AND observed_digest_sha256 IS NULL
          AND (
            (failure_code IN (
              'MODEL_BINDING_PROVIDER_UNAVAILABLE',
              'MODEL_BINDING_PROVIDER_PULL_FAILED',
              'MODEL_BINDING_TARGET_NOT_INSTALLED'
            ) AND retryable = 1)
            OR
            (failure_code IN (
              'MODEL_BINDING_TARGET_DIGEST_MISSING',
              'MODEL_BINDING_TARGET_AMBIGUOUS',
              'MODEL_BINDING_TARGET_DIGEST_DRIFT'
            ) AND retryable = 0)
          ))
        OR
        (outcome = 'RECONCILED_ABSENT'
          AND observed_model_name IS NULL
          AND observed_canonical_name IS NULL
          AND observed_digest_sha256 IS NULL
          AND failure_code = 'MODEL_BINDING_PROVIDER_OUTCOME_UNRESOLVED'
          AND retryable = 1)
      ),
      CHECK (
        observed_model_name IS NULL
        OR lower(observed_model_name) = observed_canonical_name
        OR lower(observed_model_name) = observed_canonical_name || ':latest'
      )
    );
CREATE TABLE model_binding_provider_claims (
      operation_id TEXT PRIMARY KEY
        REFERENCES model_binding_provider_operations(operation_id) ON DELETE RESTRICT,
      role TEXT NOT NULL UNIQUE
        CHECK (role IN ('D1','D2','CODE','R1','R2','CHAT','VISION')),
      provider_origin TEXT NOT NULL,
      requested_canonical_name TEXT NOT NULL
        CHECK (length(trim(requested_canonical_name)) BETWEEN 1 AND 512),
      claim_token TEXT NOT NULL UNIQUE
        CHECK (length(trim(claim_token)) BETWEEN 16 AND 256),
      fencing_revision INTEGER NOT NULL
        CHECK (typeof(fencing_revision) = 'integer' AND fencing_revision >= 1),
      lease_expires_at_ms INTEGER NOT NULL
        CHECK (typeof(lease_expires_at_ms) = 'integer' AND lease_expires_at_ms > 0),
      updated_at_ms INTEGER NOT NULL
        CHECK (typeof(updated_at_ms) = 'integer' AND updated_at_ms > 0),
      UNIQUE(provider_origin, requested_canonical_name),
      CHECK (
        lease_expires_at_ms > updated_at_ms
        AND lease_expires_at_ms <= updated_at_ms + 300000
      )
    );
CREATE TABLE model_binding_user_noop_receipts (
      receipt_id TEXT PRIMARY KEY
        CHECK (length(trim(receipt_id)) BETWEEN 16 AND 256),
      request_key TEXT NOT NULL UNIQUE
        CHECK (length(trim(request_key)) BETWEEN 16 AND 128),
      role TEXT NOT NULL
        CHECK (role IN ('D1','D2','CODE','R1','R2','CHAT','VISION')),
      binding_revision INTEGER NOT NULL
        CHECK (typeof(binding_revision) = 'integer' AND binding_revision >= 1),
      model_name TEXT NOT NULL
        CHECK (length(trim(model_name)) BETWEEN 1 AND 512),
      canonical_name TEXT NOT NULL
        CHECK (length(trim(canonical_name)) BETWEEN 1 AND 512),
      digest_sha256 TEXT NOT NULL
        CHECK (
          length(digest_sha256) = 64
          AND digest_sha256 = lower(digest_sha256)
          AND digest_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
      actor TEXT NOT NULL
        CHECK (length(trim(actor)) BETWEEN 3 AND 128),
      desired_source TEXT NOT NULL
        CHECK (desired_source IN (
          'CONFIG_DEFAULT','LEGACY_OVERRIDE','USER_APPLY','USER_ROLLBACK'
        )),
      desired_actor TEXT NOT NULL
        CHECK (length(trim(desired_actor)) BETWEEN 3 AND 128),
      desired_observed_at_ms INTEGER NOT NULL
        CHECK (typeof(desired_observed_at_ms) = 'integer' AND desired_observed_at_ms > 0),
      desired_updated_at_ms INTEGER NOT NULL
        CHECK (typeof(desired_updated_at_ms) = 'integer' AND desired_updated_at_ms > 0),
      desired_last_event_id TEXT NOT NULL
        CHECK (length(trim(desired_last_event_id)) BETWEEN 16 AND 256),
      provider_command_cutoff_seq INTEGER NOT NULL DEFAULT 0
        CHECK (
          typeof(provider_command_cutoff_seq) = 'integer'
          AND provider_command_cutoff_seq >= 0
        ),
      source_provider_operation_id TEXT
        REFERENCES model_binding_provider_operations(operation_id) ON DELETE RESTRICT,
      created_at_ms INTEGER NOT NULL
        CHECK (typeof(created_at_ms) = 'integer' AND created_at_ms > 0),
      CHECK (
        lower(model_name) = canonical_name
        OR lower(model_name) = canonical_name || ':latest'
      )
    );
CREATE TABLE model_binding_user_noop_provider_supersedes (
      receipt_id TEXT NOT NULL
        REFERENCES model_binding_user_noop_receipts(receipt_id) ON DELETE RESTRICT,
      provider_operation_id TEXT NOT NULL UNIQUE
        REFERENCES model_binding_provider_operations(operation_id) ON DELETE RESTRICT,
      PRIMARY KEY (receipt_id, provider_operation_id)
    );
CREATE TABLE model_binding_runtime_finalize_cutoffs (
      operation_id TEXT PRIMARY KEY,
      max_preexisting_runtime_attempt_revision INTEGER NOT NULL
        CHECK (
          typeof(max_preexisting_runtime_attempt_revision) = 'integer'
          AND max_preexisting_runtime_attempt_revision >= 0
        ),
      FOREIGN KEY (operation_id)
        REFERENCES model_binding_operations(operation_id)
        ON DELETE RESTRICT
    );
CREATE TABLE model_binding_runtime_finalize_receipts (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      operation_id TEXT NOT NULL,
      runtime_attempt_revision INTEGER NOT NULL
        CHECK (
          typeof(runtime_attempt_revision) = 'integer'
          AND runtime_attempt_revision >= 1
        ),
      finalization_kind TEXT NOT NULL
        CHECK (finalization_kind IN ('DIRECT_CONFIRMED','RECOVERED_BY')),
      config_version INTEGER
        CHECK (
          config_version IS NULL
          OR (typeof(config_version) = 'integer' AND config_version >= 0)
        ),
      recovered_by_attempt_revision INTEGER
        CHECK (
          recovered_by_attempt_revision IS NULL
          OR (
            typeof(recovered_by_attempt_revision) = 'integer'
            AND recovered_by_attempt_revision >= 1
          )
        ),
      created_at_ms INTEGER NOT NULL
        CHECK (typeof(created_at_ms) = 'integer' AND created_at_ms > 0),

      UNIQUE(operation_id, runtime_attempt_revision),
      FOREIGN KEY (operation_id, runtime_attempt_revision)
        REFERENCES model_binding_application_attempts(operation_id, attempt_revision)
        ON DELETE RESTRICT,
      FOREIGN KEY (operation_id, recovered_by_attempt_revision)
        REFERENCES model_binding_application_attempts(operation_id, attempt_revision)
        ON DELETE RESTRICT,
      CHECK (
        (finalization_kind = 'DIRECT_CONFIRMED'
          AND config_version IS NOT NULL
          AND recovered_by_attempt_revision IS NULL)
        OR
        (finalization_kind = 'RECOVERED_BY'
          AND config_version IS NULL
          AND recovered_by_attempt_revision > runtime_attempt_revision)
      )
    );
CREATE TABLE model_automation_policy_events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE
        CHECK (length(event_id) BETWEEN 16 AND 160),
      request_id TEXT NOT NULL UNIQUE
        CHECK (length(request_id) BETWEEN 16 AND 160),
      schema_version INTEGER NOT NULL DEFAULT 1
        CHECK (typeof(schema_version) = 'integer' AND schema_version = 1),
      previous_revision INTEGER NOT NULL
        CHECK (typeof(previous_revision) = 'integer' AND previous_revision >= 0),
      committed_revision INTEGER NOT NULL UNIQUE
        CHECK (typeof(committed_revision) = 'integer' AND committed_revision >= 1),
      event_kind TEXT NOT NULL
        CHECK (event_kind IN (
          'MIGRATION_DEFAULT_OFF',
          'USER_UPDATE',
          'BACKUP_IMPORT',
          'GLOBAL_RESET'
        )),
      actor TEXT NOT NULL
        CHECK (
          length(actor) BETWEEN 3 AND 96
          AND actor NOT GLOB '*[^A-Za-z0-9:._-]*'
        ),
      source TEXT NOT NULL
        CHECK (source IN ('MIGRATION','TYPED_API','SETTINGS_IMPORT','GLOBAL_RESET')),
      before_auto_failover_enabled INTEGER NOT NULL
        CHECK (typeof(before_auto_failover_enabled) = 'integer'
          AND before_auto_failover_enabled IN (0, 1)),
      before_auto_cleanup_enabled INTEGER NOT NULL
        CHECK (typeof(before_auto_cleanup_enabled) = 'integer'
          AND before_auto_cleanup_enabled IN (0, 1)),
      before_auto_cleanup_days INTEGER NOT NULL
        CHECK (typeof(before_auto_cleanup_days) = 'integer'
          AND before_auto_cleanup_days BETWEEN 1 AND 3650),
      after_auto_failover_enabled INTEGER NOT NULL
        CHECK (typeof(after_auto_failover_enabled) = 'integer'
          AND after_auto_failover_enabled IN (0, 1)),
      after_auto_cleanup_enabled INTEGER NOT NULL
        CHECK (typeof(after_auto_cleanup_enabled) = 'integer'
          AND after_auto_cleanup_enabled IN (0, 1)),
      after_auto_cleanup_days INTEGER NOT NULL
        CHECK (typeof(after_auto_cleanup_days) = 'integer'
          AND after_auto_cleanup_days BETWEEN 1 AND 3650),
      legacy_quarantine_json TEXT
        CHECK (
          legacy_quarantine_json IS NULL
          OR (json_valid(legacy_quarantine_json)
            AND json_type(legacy_quarantine_json, '$') = 'object')
        ),
      created_at_ms INTEGER NOT NULL
        CHECK (typeof(created_at_ms) = 'integer' AND created_at_ms > 0),

      CHECK (committed_revision = previous_revision + 1),
      CHECK (
        (event_kind = 'MIGRATION_DEFAULT_OFF'
          AND source = 'MIGRATION'
          AND actor = 'system:migration-061'
          AND previous_revision = 0
          AND committed_revision = 1
          AND before_auto_failover_enabled = 0
          AND before_auto_cleanup_enabled = 0
          AND before_auto_cleanup_days = 14
          AND after_auto_failover_enabled = 0
          AND after_auto_cleanup_enabled = 0
          AND after_auto_cleanup_days = 14)
        OR
        (event_kind <> 'MIGRATION_DEFAULT_OFF'
          AND source <> 'MIGRATION'
          AND actor LIKE 'user:%'
          AND committed_revision >= 2
          AND legacy_quarantine_json IS NULL)
      ),
      CHECK (
        (event_kind = 'USER_UPDATE' AND source = 'TYPED_API')
        OR (event_kind = 'BACKUP_IMPORT' AND source = 'SETTINGS_IMPORT')
        OR (event_kind = 'GLOBAL_RESET' AND source = 'GLOBAL_RESET')
        OR event_kind = 'MIGRATION_DEFAULT_OFF'
      )
    );
CREATE TABLE model_automation_policy (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      schema_version INTEGER NOT NULL DEFAULT 1
        CHECK (typeof(schema_version) = 'integer' AND schema_version = 1),
      revision INTEGER NOT NULL
        CHECK (typeof(revision) = 'integer' AND revision >= 1),
      auto_failover_enabled INTEGER NOT NULL
        CHECK (typeof(auto_failover_enabled) = 'integer'
          AND auto_failover_enabled IN (0, 1)),
      auto_cleanup_enabled INTEGER NOT NULL
        CHECK (typeof(auto_cleanup_enabled) = 'integer'
          AND auto_cleanup_enabled IN (0, 1)),
      auto_cleanup_days INTEGER NOT NULL
        CHECK (typeof(auto_cleanup_days) = 'integer'
          AND auto_cleanup_days BETWEEN 1 AND 3650),
      last_event_id TEXT NOT NULL UNIQUE
        REFERENCES model_automation_policy_events(event_id)
        ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
      updated_at_ms INTEGER NOT NULL
        CHECK (typeof(updated_at_ms) = 'integer' AND updated_at_ms > 0)
    );
CREATE TABLE model_failover_proof_artifacts (
      proof_id TEXT PRIMARY KEY
        CHECK (length(trim(proof_id)) BETWEEN 16 AND 128),
      validation_run_id TEXT NOT NULL
        CHECK (length(trim(validation_run_id)) BETWEEN 1 AND 128),
      parent_run_id TEXT NOT NULL UNIQUE
        CHECK (length(trim(parent_run_id)) BETWEEN 1 AND 128),
      source_revision TEXT NOT NULL
        CHECK (
          length(source_revision) = 40
          AND source_revision = lower(source_revision)
          AND source_revision NOT GLOB '*[^0-9a-f]*'
        ),
      measurement_artifact_sha256 TEXT NOT NULL UNIQUE
        CHECK (
          length(measurement_artifact_sha256) = 64
          AND measurement_artifact_sha256 = lower(measurement_artifact_sha256)
          AND measurement_artifact_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
      measurement_artifact_byte_length INTEGER NOT NULL
        CHECK (
          typeof(measurement_artifact_byte_length) = 'integer'
          AND measurement_artifact_byte_length > 0
          AND measurement_artifact_byte_length <= 9007199254740991
        ),
      acceptance_artifact_sha256 TEXT NOT NULL UNIQUE
        CHECK (
          length(acceptance_artifact_sha256) = 64
          AND acceptance_artifact_sha256 = lower(acceptance_artifact_sha256)
          AND acceptance_artifact_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
      acceptance_artifact_byte_length INTEGER NOT NULL
        CHECK (
          typeof(acceptance_artifact_byte_length) = 'integer'
          AND acceptance_artifact_byte_length > 0
          AND acceptance_artifact_byte_length <= 9007199254740991
        ),
      role TEXT NOT NULL
        CHECK (role IN ('D1','D2','CODE','R1','R2','CHAT','VISION')),
      suite TEXT NOT NULL
        CHECK (suite IN ('reasoning','code','chat','vision','review')),
      role_contract_sha256 TEXT NOT NULL
        CHECK (
          length(role_contract_sha256) = 64
          AND role_contract_sha256 = lower(role_contract_sha256)
          AND role_contract_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
      model_name TEXT NOT NULL
        CHECK (length(trim(model_name)) BETWEEN 1 AND 512),
      model_canonical_name TEXT NOT NULL
        CHECK (length(trim(model_canonical_name)) BETWEEN 1 AND 512),
      model_digest_sha256 TEXT NOT NULL
        CHECK (
          length(model_digest_sha256) = 64
          AND model_digest_sha256 = lower(model_digest_sha256)
          AND model_digest_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
      validation_version TEXT NOT NULL
        CHECK (length(trim(validation_version)) BETWEEN 1 AND 64),
      policy_version TEXT NOT NULL
        CHECK (length(trim(policy_version)) BETWEEN 1 AND 64),
      score REAL NOT NULL CHECK (score >= 0 AND score <= 1),
      required_score REAL NOT NULL CHECK (required_score > 0 AND required_score <= 1),
      passed_count INTEGER NOT NULL
        CHECK (typeof(passed_count) = 'integer' AND passed_count >= 0),
      required_passed_count INTEGER NOT NULL
        CHECK (typeof(required_passed_count) = 'integer' AND required_passed_count >= 1),
      total_count INTEGER NOT NULL
        CHECK (typeof(total_count) = 'integer' AND total_count > 0),
      duration_ms INTEGER NOT NULL
        CHECK (typeof(duration_ms) = 'integer' AND duration_ms >= 0),
      result TEXT NOT NULL CHECK (result = 'PASS'),
      inventory_before_name TEXT NOT NULL
        CHECK (length(trim(inventory_before_name)) BETWEEN 1 AND 512),
      inventory_before_digest TEXT NOT NULL,
      inventory_after_name TEXT NOT NULL
        CHECK (length(trim(inventory_after_name)) BETWEEN 1 AND 512),
      inventory_after_digest TEXT NOT NULL,
      measurement_started_at_ms INTEGER NOT NULL
        CHECK (
          typeof(measurement_started_at_ms) = 'integer'
          AND measurement_started_at_ms > 0
          AND measurement_started_at_ms <= 9007199254740991
        ),
      measurement_completed_at_ms INTEGER NOT NULL
        CHECK (
          typeof(measurement_completed_at_ms) = 'integer'
          AND measurement_completed_at_ms >= measurement_started_at_ms
          AND measurement_completed_at_ms <= 9007199254740991
        ),
      acceptance_completed_at_ms INTEGER NOT NULL
        CHECK (
          typeof(acceptance_completed_at_ms) = 'integer'
          AND acceptance_completed_at_ms >= measurement_completed_at_ms
          AND acceptance_completed_at_ms <= 9007199254740991
        ),
      proof_ttl_ms INTEGER NOT NULL
        CHECK (
          typeof(proof_ttl_ms) = 'integer'
          AND proof_ttl_ms > 0
          AND proof_ttl_ms <= 9007199254740991
        ),
      expires_at_ms INTEGER NOT NULL
        CHECK (
          typeof(expires_at_ms) = 'integer'
          AND expires_at_ms > measurement_completed_at_ms
          AND expires_at_ms <= 9007199254740991
        ),
      issued_at_ms INTEGER NOT NULL
        CHECK (
          typeof(issued_at_ms) = 'integer'
          AND issued_at_ms >= acceptance_completed_at_ms
          AND issued_at_ms <= 9007199254740991
        ),

      FOREIGN KEY (proof_id)
        REFERENCES model_failover_proofs(proof_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
      UNIQUE(validation_run_id, role),
      CHECK (acceptance_artifact_sha256 <> measurement_artifact_sha256),
      CHECK (passed_count <= total_count),
      CHECK (required_passed_count <= total_count),
      CHECK (score >= required_score),
      CHECK (passed_count >= required_passed_count),
      CHECK (inventory_before_digest = model_digest_sha256),
      CHECK (inventory_after_digest = model_digest_sha256),
      CHECK (duration_ms = measurement_completed_at_ms - measurement_started_at_ms),
      CHECK (acceptance_completed_at_ms <= 9007199254740991 - proof_ttl_ms),
      CHECK (expires_at_ms = acceptance_completed_at_ms + proof_ttl_ms),
      CHECK (issued_at_ms < expires_at_ms)
    ) WITHOUT ROWID;
CREATE INDEX idx_project_memory_project ON project_memory(project_id);
CREATE INDEX idx_chat_messages_session ON chat_messages(session_id);
CREATE INDEX idx_agent_logs_agent ON agent_logs(agent_id);
CREATE INDEX idx_learned_patterns_hash ON learned_patterns(pattern_hash);
CREATE INDEX idx_workflow_sessions_state ON workflow_sessions(state);
CREATE INDEX idx_conversations_project ON conversations(project_id);
CREATE INDEX idx_conversations_updated ON conversations(updated_at DESC);
CREATE INDEX idx_messages_conversation ON messages(conversation_id);
CREATE INDEX idx_attachments_conversation ON attachments(conversation_id);
CREATE INDEX idx_attachments_project ON attachments(project_id);
CREATE INDEX idx_conv_expertises_conv ON conversation_expertises(conversation_id);
CREATE INDEX idx_conv_expertises_expertise ON conversation_expertises(expertise_id);
CREATE INDEX idx_merge_audit_conv ON merge_audit_log(conversation_id);
CREATE INDEX idx_cap_drift_conv ON capability_drift_log(conversation_id);
CREATE INDEX idx_cap_drift_expert ON capability_drift_log(expert_id);
CREATE INDEX idx_llm_exec_conv ON llm_execution_log(conversation_id);
CREATE INDEX idx_lifecycles_project ON project_lifecycles(project_id);
CREATE INDEX idx_lifecycles_phase ON project_lifecycles(phase);
CREATE INDEX idx_roadmap_versions_lifecycle ON roadmap_versions(lifecycle_id);
CREATE INDEX idx_milestones_lifecycle ON milestones(lifecycle_id);
CREATE INDEX idx_milestones_status ON milestones(status);
CREATE INDEX idx_change_requests_lifecycle ON change_requests(lifecycle_id);
CREATE INDEX idx_drift_checks_lifecycle ON drift_checks(lifecycle_id);
CREATE INDEX idx_drift_checks_milestone ON drift_checks(milestone_id);
CREATE INDEX idx_lhs_lifecycle ON lifecycle_handoff_state(lifecycle_id);
CREATE INDEX idx_merge_audit_trace ON merge_audit_log(execution_trace_id);
CREATE INDEX idx_cap_drift_trace ON capability_drift_log(execution_trace_id);
CREATE INDEX idx_llm_exec_trace ON llm_execution_log(execution_trace_id);
CREATE INDEX idx_cre_override_trace ON cre_override_log(execution_trace_id);
CREATE INDEX idx_cre_override_conv ON cre_override_log(conversation_id);
CREATE INDEX idx_cre_override_source ON cre_override_log(source);
CREATE INDEX idx_cre_override_type ON cre_override_log(event_type);
CREATE INDEX idx_kf_domain_cat ON knowledge_facts(domain, category);
CREATE INDEX idx_kf_specialist ON knowledge_facts(specialist_id);
CREATE INDEX idx_kf_year ON knowledge_facts(year);
CREATE INDEX idx_kf_key ON knowledge_facts(domain, key);
CREATE INDEX idx_kvl_fact ON knowledge_verification_log(fact_id);
CREATE INDEX idx_kvl_action ON knowledge_verification_log(action);
CREATE INDEX idx_fe_entity_year ON financial_entries(entity_id, period_year);
CREATE INDEX idx_fe_entity_date ON financial_entries(entity_id, entry_date);
CREATE INDEX idx_fe_active ON financial_entries(entity_id, deleted_at);
CREATE INDEX idx_eh_entry ON entry_history(entry_id);
CREATE INDEX idx_cr_entity_year ON calculation_runs(entity_id, year);
CREATE INDEX idx_expertise_bindings_conv ON expertise_bindings(conversation_id);
CREATE INDEX idx_expertises_domain ON expertises(domain);
CREATE INDEX idx_expertise_memory_id ON expertise_memory(expertise_id);
CREATE INDEX idx_cap_drift_expertise ON capability_drift_log(expertise_id);
CREATE INDEX idx_pl_entity ON period_locks(entity_id);
CREATE INDEX idx_tl_entity ON tax_losses(entity_id);
CREATE INDEX idx_vp_entity ON vat_periods(entity_id);
CREATE INDEX idx_fe_supply_date ON financial_entries(entity_id, supply_date) WHERE supply_date IS NOT NULL;
CREATE INDEX idx_cc_entity_year ON compliance_checks(entity_id, year);
CREATE INDEX idx_cc_rule ON compliance_checks(rule_code, year);
CREATE INDEX idx_specialists_status ON specialists(status);
CREATE INDEX idx_specialists_domain ON specialists(domain);
CREATE INDEX idx_projects_status ON projects(status);
CREATE INDEX idx_conversations_state ON conversations(state);
CREATE INDEX idx_specialist_memory_conv ON specialist_memory(specialist_id, conversation_id);
CREATE INDEX idx_quality_scores_lifecycle ON quality_scores(lifecycle_id);
CREATE INDEX idx_quality_scores_type ON quality_scores(lifecycle_id, artifact_type);
CREATE INDEX idx_telemetry_created_at ON telemetry_snapshots(created_at);
CREATE INDEX idx_telemetry_intent ON telemetry_snapshots(intent);
CREATE INDEX idx_telemetry_classified_by ON telemetry_snapshots(classified_by);
CREATE INDEX idx_telemetry_session ON telemetry_snapshots(session_id);
CREATE INDEX idx_specialist_telemetry_type ON specialist_telemetry(event_type);
CREATE INDEX idx_specialist_telemetry_specialist ON specialist_telemetry(specialist_id);
CREATE INDEX idx_specialist_telemetry_created ON specialist_telemetry(created_at);
CREATE INDEX idx_telemetry_metrics_window ON telemetry_metrics(window_start);
CREATE INDEX idx_telemetry_metrics_end ON telemetry_metrics(window_end);
CREATE INDEX idx_telemetry_alerts_type ON telemetry_alerts(alert_type);
CREATE INDEX idx_telemetry_alerts_ack ON telemetry_alerts(acknowledged);
CREATE INDEX idx_telemetry_improvements_status ON telemetry_improvements(status);
CREATE INDEX idx_telemetry_improvements_param ON telemetry_improvements(parameter);
CREATE INDEX idx_skill_exec_state ON skill_executions(state);
CREATE INDEX idx_skill_exec_skill ON skill_executions(skill_id);
CREATE INDEX idx_skill_steps_exec ON skill_steps(execution_id);
CREATE INDEX idx_messages_created_at ON messages(created_at);
CREATE INDEX idx_agent_logs_created_at ON agent_logs(created_at);
CREATE INDEX idx_cre_override_log_created_at ON cre_override_log(created_at);
CREATE INDEX idx_conversations_deleted_at ON conversations(deleted_at);
CREATE INDEX idx_messages_archived ON messages(archived, created_at);
CREATE INDEX idx_memory_user_kind ON memory(user_id, kind);
CREATE INDEX idx_memory_key ON memory(user_id, key);
CREATE INDEX idx_wp_count ON workflow_patterns(count);
CREATE INDEX idx_wp_proposed ON workflow_patterns(proposed);
CREATE INDEX idx_auto_expertise_ts ON auto_expertise_log(timestamp);
CREATE INDEX idx_auto_expertise_selected ON auto_expertise_log(selected_id);
CREATE INDEX idx_api_tokens_hash ON api_tokens(token_hash);
CREATE INDEX idx_spec_exp_specialist ON specialist_expertises(specialist_id);
CREATE INDEX idx_fb_attach_fid ON feedback_attachments(feedback_id);
CREATE INDEX idx_arch_state_lifecycle ON architecture_state(lifecycle_id);
CREATE INDEX idx_arch_state_milestone ON architecture_state(milestone_id);
CREATE INDEX idx_api_contracts_lifecycle ON api_contracts(lifecycle_id);
CREATE INDEX idx_api_contracts_file ON api_contracts(file_path);
CREATE INDEX idx_api_contracts_export ON api_contracts(export_name);
CREATE INDEX idx_upgrade_history_role ON upgrade_history(role);
CREATE INDEX idx_upgrade_history_created ON upgrade_history(created_at);
CREATE INDEX idx_task_memory_project ON task_memory(project_id);
CREATE INDEX idx_task_memory_key ON task_memory(project_id, key);
CREATE INDEX idx_task_memory_kind ON task_memory(project_id, kind);
CREATE INDEX idx_task_memory_confidence ON task_memory(confidence);
CREATE INDEX idx_proposals_status
      ON upgrade_proposals(status);
CREATE INDEX idx_proposals_role_status
      ON upgrade_proposals(role, status);
CREATE INDEX idx_proposals_cooldown
      ON upgrade_proposals(role, candidate_model, cooldown_until);
CREATE INDEX idx_proposals_candidate_status
      ON upgrade_proposals(candidate_model, status);
CREATE INDEX idx_catalog_cache_verified
      ON model_catalog_cache(verified_at);
CREATE INDEX idx_mp_role_model
      ON model_performance(role, model);
CREATE INDEX idx_mp_role_created
      ON model_performance(role, created_at);
CREATE INDEX idx_mp_model_task
      ON model_performance(model, task_type);
CREATE INDEX idx_dm_family ON discovered_models(family);
CREATE INDEX idx_dm_name ON discovered_models(name);
CREATE INDEX idx_vr_model_suite
      ON validation_results(model, suite);
CREATE UNIQUE INDEX idx_vr_unique
      ON validation_results(model, suite, test_name);
CREATE UNIQUE INDEX idx_vss_model_suite
      ON validation_suite_scores(model, suite);
CREATE INDEX idx_mp_type ON marketplace_packages(type);
CREATE INDEX idx_mg_status ON media_generations(status);
CREATE INDEX idx_mg_created ON media_generations(created_at);
CREATE INDEX idx_mg_favorite ON media_generations(favorite);
CREATE INDEX idx_mu_model ON model_usage(model);
CREATE INDEX idx_mu_used ON model_usage(used_at DESC);
CREATE INDEX idx_gov_reports_created ON governor_reports(created_at);
CREATE INDEX idx_gov_proposals_status ON governor_proposals(status);
CREATE INDEX idx_gov_proposals_hash ON governor_proposals(hash, status);
CREATE INDEX idx_gov_proposals_rule ON governor_proposals(rule_id, status);
CREATE INDEX idx_universe_model ON model_universe_raw(model_name);
CREATE INDEX idx_universe_state ON model_universe_raw(metadata_state);
CREATE INDEX idx_universe_verified ON model_universe_raw(last_verified_at);
CREATE INDEX idx_universe_idempotency ON model_universe_raw(idempotency_key);
CREATE INDEX idx_universe_idempotency_exp ON model_universe_raw(idempotency_expires_at);
CREATE INDEX idx_ud_model ON model_universe_derived(model_name);
CREATE INDEX idx_ud_recompute ON model_universe_derived(recompute_at);
CREATE INDEX idx_signals_model ON model_signal_events(model_name);
CREATE INDEX idx_signals_time ON model_signal_events(created_at);
CREATE INDEX idx_registry_delta_key ON registry_delta(snapshot_key);
CREATE INDEX idx_registry_delta_exp ON registry_delta(expires_at);
CREATE INDEX idx_recon_model ON model_reconciliation_log(model_name);
CREATE INDEX idx_recon_time ON model_reconciliation_log(created_at);
CREATE INDEX idx_write_model ON model_write_log(model_name);
CREATE INDEX idx_write_token ON model_write_log(write_token);
CREATE INDEX idx_write_time ON model_write_log(created_at);
CREATE INDEX idx_ud_based_on_version ON model_universe_derived(based_on_version);
CREATE INDEX idx_ud_last_computed ON model_universe_derived(last_computed_at);
CREATE INDEX idx_recon_reason ON model_reconciliation_log(reason_code);
CREATE INDEX idx_runtime_guard_state ON model_runtime_guard(state);
CREATE INDEX idx_runtime_guard_disabled_until ON model_runtime_guard(disabled_until);
CREATE INDEX idx_runtime_guard_updated ON model_runtime_guard(updated_at);
CREATE INDEX idx_notif_log_agent
    ON notification_log_v57(agent_id, created_at DESC)
  ;
CREATE INDEX idx_digest_buffer_agent
    ON notification_digest_buffer_v57(agent_id, created_at ASC)
  ;
CREATE INDEX idx_agent_runs_agent ON agent_runs_v33(agent_id);
CREATE INDEX idx_agent_runs_started ON agent_runs_v33(started_at DESC);
CREATE INDEX idx_agent_notif_agent ON agent_notifications_v33(agent_id);
CREATE INDEX idx_agent_notif_read ON agent_notifications_v33(read_at);
CREATE INDEX idx_agent_schedule_next ON agent_schedule_v33(next_run);
CREATE INDEX idx_agent_seen_lookup ON agent_seen_items_v57(agent_id, source_id, item_id);
CREATE INDEX idx_event_log_level ON event_log(level);
CREATE INDEX idx_event_log_created ON event_log(created_at);
CREATE INDEX idx_notif_log_agent_created
          ON notification_log_v57(agent_id, created_at)
      ;
CREATE INDEX idx_notif_log_useful
          ON notification_log_v57(agent_id, useful)
          WHERE useful IS NOT NULL
      ;
CREATE INDEX idx_model_failover_proof_eligibility
      ON model_failover_proofs(role, model_digest_sha256, expires_at_ms DESC);
CREATE UNIQUE INDEX idx_model_failover_event_operation
      ON model_failover_events(operation_id, event_type)
      WHERE operation_id IS NOT NULL;
CREATE INDEX idx_model_failover_event_role_seq
      ON model_failover_events(role, seq DESC);
CREATE INDEX idx_model_failover_event_episode
      ON model_failover_events(episode_id, seq)
      WHERE episode_id IS NOT NULL;
CREATE INDEX idx_model_failover_state_active
      ON model_failover_state(active_failover, state);
CREATE INDEX idx_model_failover_state_claim_expiry
      ON model_failover_state(claim_expires_at_ms)
      WHERE claim_token IS NOT NULL;
CREATE INDEX idx_model_binding_operations_role_revision
      ON model_binding_operations(role, committed_binding_revision DESC);
CREATE INDEX idx_model_binding_operations_predecessor
      ON model_binding_operations(predecessor_operation_id)
      WHERE predecessor_operation_id IS NOT NULL;
CREATE UNIQUE INDEX idx_model_binding_operations_one_rollback
      ON model_binding_operations(rollback_of_operation_id)
      WHERE rollback_of_operation_id IS NOT NULL;
CREATE INDEX idx_model_binding_application_operation
      ON model_binding_application_attempts(operation_id, attempt_revision);
CREATE INDEX idx_model_binding_runtime_finalize_operation
      ON model_binding_runtime_finalize_receipts(
        operation_id, runtime_attempt_revision, finalization_kind
      );
CREATE VIRTUAL TABLE chat_fts USING fts5(
    content,
    content='chat_messages',
    content_rowid='id'
)
/* chat_fts(content) */;
CREATE VIRTUAL TABLE messages_fts USING fts5(
    content,
    content='messages',
    content_rowid='id'
)
/* messages_fts(content) */;
CREATE TRIGGER chat_ai AFTER INSERT ON chat_messages BEGIN
    INSERT INTO chat_fts(rowid, content) VALUES (new.id, new.content);
END;
CREATE TRIGGER chat_ad AFTER DELETE ON chat_messages BEGIN
    INSERT INTO chat_fts(chat_fts, rowid, content) VALUES('delete', old.id, old.content);
END;
CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
END;
CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.id, old.content);
END;
CREATE TRIGGER messages_count_ai AFTER INSERT ON messages BEGIN
    UPDATE conversations SET message_count = message_count + 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = new.conversation_id;
END;
CREATE TRIGGER messages_count_ad AFTER DELETE ON messages BEGIN
    UPDATE conversations SET message_count = message_count - 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = old.conversation_id;
END;
CREATE TRIGGER trg_model_failover_proofs_append_only_update
    BEFORE UPDATE ON model_failover_proofs
    BEGIN
      SELECT RAISE(ABORT, 'model_failover_proofs is append-only');
    END;
CREATE TRIGGER trg_model_failover_proofs_append_only_delete
    BEFORE DELETE ON model_failover_proofs
    BEGIN
      SELECT RAISE(ABORT, 'model_failover_proofs is append-only');
    END;
CREATE TRIGGER trg_model_failover_events_append_only_update
    BEFORE UPDATE ON model_failover_events
    BEGIN
      SELECT RAISE(ABORT, 'model_failover_events is append-only');
    END;
CREATE TRIGGER trg_model_failover_events_append_only_delete
    BEFORE DELETE ON model_failover_events
    BEGIN
      SELECT RAISE(ABORT, 'model_failover_events is append-only');
    END;
CREATE TRIGGER trg_model_desired_bindings_last_event_insert
    BEFORE INSERT ON model_desired_bindings
    WHEN NOT EXISTS (
      SELECT 1 FROM model_failover_events event
      WHERE event.event_id = NEW.last_event_id
        AND event.event_type IN ('DESIRED_OBSERVED','DESIRED_CHANGED')
        AND event.role = NEW.role
        AND event.binding_revision = NEW.binding_revision
        AND event.desired_model_name = NEW.model_name
        AND event.desired_digest_sha256 = NEW.digest_sha256
    )
    BEGIN
      SELECT RAISE(ABORT, 'desired binding requires matching audit event');
    END;
CREATE TRIGGER trg_model_desired_bindings_last_event_update
    BEFORE UPDATE ON model_desired_bindings
    WHEN NOT EXISTS (
      SELECT 1 FROM model_failover_events event
      WHERE event.event_id = NEW.last_event_id
        AND event.event_type IN ('DESIRED_OBSERVED','DESIRED_CHANGED')
        AND event.role = NEW.role
        AND event.binding_revision = NEW.binding_revision
        AND event.desired_model_name = NEW.model_name
        AND event.desired_digest_sha256 = NEW.digest_sha256
    )
    BEGIN
      SELECT RAISE(ABORT, 'desired binding requires matching audit event');
    END;
CREATE TRIGGER trg_model_failover_state_last_event_insert
    BEFORE INSERT ON model_failover_state
    WHEN NOT EXISTS (
      SELECT 1
      FROM model_failover_events event
      JOIN model_desired_bindings desired
        ON desired.role = NEW.role
       AND desired.binding_revision = NEW.desired_revision
      WHERE event.event_id = NEW.last_event_id
        AND event.role = NEW.role
        AND event.binding_revision = NEW.desired_revision
        AND event.episode_id = NEW.episode_id
        AND event.row_version = NEW.row_version
        AND event.state_after = NEW.state
        AND event.policy_version = NEW.policy_version
        AND event.desired_model_name = desired.model_name
        AND event.desired_digest_sha256 = desired.digest_sha256
        AND event.created_at_ms = NEW.updated_at_ms
    )
    BEGIN
      SELECT RAISE(ABORT, 'failover state requires matching audit event');
    END;
CREATE TRIGGER trg_model_failover_state_last_event_update
    BEFORE UPDATE ON model_failover_state
    WHEN NOT EXISTS (
      SELECT 1
      FROM model_failover_events event
      JOIN model_desired_bindings desired
        ON desired.role = NEW.role
       AND desired.binding_revision = NEW.desired_revision
      WHERE event.event_id = NEW.last_event_id
        AND event.role = NEW.role
        AND event.binding_revision = NEW.desired_revision
        AND event.episode_id = NEW.episode_id
        AND event.row_version = NEW.row_version
        AND event.state_after = NEW.state
        AND event.policy_version = NEW.policy_version
        AND event.desired_model_name = desired.model_name
        AND event.desired_digest_sha256 = desired.digest_sha256
        AND event.created_at_ms = NEW.updated_at_ms
    )
    BEGIN
      SELECT RAISE(ABORT, 'failover state requires matching audit event');
    END;
CREATE TRIGGER trg_model_failover_state_claim_event_insert
    BEFORE INSERT ON model_failover_state
    WHEN (
      NEW.claim_token IS NULL AND EXISTS (
        SELECT 1 FROM model_failover_events event
        WHERE event.event_id = NEW.last_event_id
          AND event.event_type IN (
            'ACTIVATION_CLAIMED','RESTORE_CLAIMED','REAPPLY_CLAIMED'
          )
      )
    ) OR (
      NEW.claim_token IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM model_failover_events event
        WHERE event.event_id = NEW.last_event_id
          AND event.operation_id = NEW.claim_operation_id
          AND event.created_at_ms = NEW.claim_started_at_ms
          AND (
            (NEW.claim_kind = 'ACTIVATE' AND event.event_type = 'ACTIVATION_CLAIMED')
            OR (NEW.claim_kind = 'RESTORE' AND event.event_type = 'RESTORE_CLAIMED')
            OR (NEW.claim_kind = 'REAPPLY' AND event.event_type = 'REAPPLY_CLAIMED')
          )
      )
    )
    BEGIN
      SELECT RAISE(ABORT, 'failover claim requires matching claimed event and tuple');
    END;
CREATE TRIGGER trg_model_failover_state_claim_event_update
    BEFORE UPDATE ON model_failover_state
    WHEN (
      NEW.claim_token IS NULL AND EXISTS (
        SELECT 1 FROM model_failover_events event
        WHERE event.event_id = NEW.last_event_id
          AND event.event_type IN (
            'ACTIVATION_CLAIMED','RESTORE_CLAIMED','REAPPLY_CLAIMED'
          )
      )
    ) OR (
      NEW.claim_token IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM model_failover_events event
        WHERE event.event_id = NEW.last_event_id
          AND event.operation_id = NEW.claim_operation_id
          AND event.created_at_ms = NEW.claim_started_at_ms
          AND (
            (NEW.claim_kind = 'ACTIVATE' AND event.event_type = 'ACTIVATION_CLAIMED')
            OR (NEW.claim_kind = 'RESTORE' AND event.event_type = 'RESTORE_CLAIMED')
            OR (NEW.claim_kind = 'REAPPLY' AND event.event_type = 'REAPPLY_CLAIMED')
          )
      )
    )
    BEGIN
      SELECT RAISE(ABORT, 'failover claim requires matching claimed event and tuple');
    END;
CREATE TRIGGER trg_model_failover_state_active_event_insert
    BEFORE INSERT ON model_failover_state
    WHEN NEW.active_failover = 1 AND NOT EXISTS (
      SELECT 1
      FROM model_failover_events event
      JOIN model_desired_bindings desired
        ON desired.role = NEW.role
       AND desired.binding_revision = NEW.desired_revision
      WHERE event.event_id = NEW.active_event_id
        AND event.event_type IN ('ACTIVATED','REAPPLIED')
        AND event.role = NEW.role
        AND event.binding_revision = NEW.desired_revision
        AND event.episode_id = NEW.episode_id
        AND event.row_version <= NEW.row_version
        AND event.state_after = 'ACTIVATED'
        AND event.policy_version = NEW.policy_version
        AND event.desired_model_name = desired.model_name
        AND event.desired_digest_sha256 = desired.digest_sha256
        AND event.fallback_model_name = NEW.fallback_model_name
        AND event.fallback_canonical_name = NEW.fallback_canonical_name
        AND event.fallback_digest_sha256 = NEW.fallback_digest_sha256
        AND event.proof_id = NEW.proof_id
        AND event.verified = 1
        AND event.created_at_ms = NEW.proof_verified_at_ms
        AND NEW.activated_at_ms <= event.created_at_ms
        AND (event.event_type <> 'ACTIVATED' OR NEW.activated_at_ms = event.created_at_ms)
    )
    BEGIN
      SELECT RAISE(ABORT, 'active failover requires matching terminal activation event');
    END;
CREATE TRIGGER trg_model_failover_state_active_event_update
    BEFORE UPDATE ON model_failover_state
    WHEN NEW.active_failover = 1 AND NOT EXISTS (
      SELECT 1
      FROM model_failover_events event
      JOIN model_desired_bindings desired
        ON desired.role = NEW.role
       AND desired.binding_revision = NEW.desired_revision
      WHERE event.event_id = NEW.active_event_id
        AND event.event_type IN ('ACTIVATED','REAPPLIED')
        AND event.role = NEW.role
        AND event.binding_revision = NEW.desired_revision
        AND event.episode_id = NEW.episode_id
        AND event.row_version <= NEW.row_version
        AND event.state_after = 'ACTIVATED'
        AND event.policy_version = NEW.policy_version
        AND event.desired_model_name = desired.model_name
        AND event.desired_digest_sha256 = desired.digest_sha256
        AND event.fallback_model_name = NEW.fallback_model_name
        AND event.fallback_canonical_name = NEW.fallback_canonical_name
        AND event.fallback_digest_sha256 = NEW.fallback_digest_sha256
        AND event.proof_id = NEW.proof_id
        AND event.verified = 1
        AND event.created_at_ms = NEW.proof_verified_at_ms
        AND NEW.activated_at_ms <= event.created_at_ms
        AND (event.event_type <> 'ACTIVATED' OR NEW.activated_at_ms = event.created_at_ms)
    )
    BEGIN
      SELECT RAISE(ABORT, 'active failover requires matching terminal activation event');
    END;
CREATE TRIGGER trg_model_desired_bindings_manual_operation_insert
    BEFORE INSERT ON model_desired_bindings
    WHEN NEW.source IN ('USER_APPLY','USER_ROLLBACK') AND NOT EXISTS (
      SELECT 1
      FROM model_binding_operations operation
      WHERE operation.role = NEW.role
        AND operation.operation_kind = NEW.source
        AND operation.committed_binding_revision = NEW.binding_revision
        AND operation.target_model_name = NEW.model_name
        AND operation.target_canonical_name = NEW.canonical_name
        AND operation.target_digest_sha256 = NEW.digest_sha256
        AND operation.actor = NEW.actor
        AND operation.desired_event_id = NEW.last_event_id
        AND operation.created_at_ms = NEW.observed_at_ms
        AND operation.created_at_ms = NEW.updated_at_ms
    )
    BEGIN
      SELECT RAISE(ABORT, 'manual desired projection requires matching binding operation');
    END;
CREATE TRIGGER trg_model_desired_bindings_manual_operation_update
    BEFORE UPDATE ON model_desired_bindings
    WHEN NEW.source IN ('USER_APPLY','USER_ROLLBACK') AND NOT EXISTS (
      SELECT 1
      FROM model_binding_operations operation
      WHERE OLD.role = NEW.role
        AND operation.role = NEW.role
        AND operation.operation_kind = NEW.source
        AND operation.expected_binding_revision = OLD.binding_revision
        AND operation.committed_binding_revision = NEW.binding_revision
        AND NEW.binding_revision = OLD.binding_revision + 1
        AND operation.previous_model_name = OLD.model_name
        AND operation.previous_canonical_name = OLD.canonical_name
        AND operation.previous_digest_sha256 = OLD.digest_sha256
        AND operation.target_model_name = NEW.model_name
        AND operation.target_canonical_name = NEW.canonical_name
        AND operation.target_digest_sha256 = NEW.digest_sha256
        AND operation.actor = NEW.actor
        AND operation.desired_event_id = NEW.last_event_id
        AND operation.created_at_ms = NEW.observed_at_ms
        AND operation.created_at_ms = NEW.updated_at_ms
    )
    BEGIN
      SELECT RAISE(ABORT, 'manual desired projection requires matching binding operation');
    END;
CREATE TRIGGER trg_model_desired_bindings_manual_authority_update
    BEFORE UPDATE ON model_desired_bindings
    WHEN OLD.source IN ('USER_APPLY','USER_ROLLBACK')
      AND NEW.source NOT IN ('USER_APPLY','USER_ROLLBACK')
    BEGIN
      SELECT RAISE(ABORT, 'manual desired projection cannot leave operation authority');
    END;
CREATE TRIGGER trg_model_desired_bindings_manual_authority_delete
    BEFORE DELETE ON model_desired_bindings
    WHEN OLD.source IN ('USER_APPLY','USER_ROLLBACK')
    BEGIN
      SELECT RAISE(ABORT, 'manual desired projection cannot be deleted without reconciliation');
    END;
CREATE TRIGGER trg_model_desired_bindings_manual_authority_replace
    BEFORE INSERT ON model_desired_bindings
    WHEN EXISTS (
      SELECT 1
      FROM model_desired_bindings current
      WHERE current.role = NEW.role
        AND current.source IN ('USER_APPLY','USER_ROLLBACK')
    )
    BEGIN
      SELECT RAISE(ABORT, 'manual desired projection cannot be replaced without reconciliation');
    END;
CREATE TRIGGER trg_model_binding_operations_append_only_update
    BEFORE UPDATE ON model_binding_operations
    BEGIN
      SELECT RAISE(ABORT, 'model_binding_operations is append-only');
    END;
CREATE TRIGGER trg_model_binding_operations_append_only_delete
    BEFORE DELETE ON model_binding_operations
    BEGIN
      SELECT RAISE(ABORT, 'model_binding_operations is append-only');
    END;
CREATE VIEW model_failover_manual_supersede_eligible AS
    SELECT incident.role, incident.desired_revision, incident.episode_id,
      incident.row_version, incident.policy_version, incident.updated_at_ms,
      incident.last_event_id, origin.desired_model_name,
      origin.desired_digest_sha256
    FROM model_failover_state incident
    JOIN model_failover_events origin
      ON origin.event_type = 'DETECTED'
     AND origin.role = incident.role
     AND origin.binding_revision = incident.desired_revision
     AND origin.row_version = 1
     AND origin.episode_id = incident.episode_id
     AND origin.operation_id IS NULL
     AND origin.actor = 'system:binding-integrity'
     AND origin.reason_code = 'BOUND_MODEL_NOT_INSTALLED'
     AND origin.policy_version = incident.policy_version
     AND origin.state_before IS NULL
     AND origin.state_after = 'DETECTED'
     AND origin.fallback_model_name IS NULL
     AND origin.fallback_canonical_name IS NULL
     AND origin.fallback_digest_sha256 IS NULL
     AND origin.proof_id IS NULL
     AND origin.verified = 0
     AND origin.failure_phase IS NULL
     AND origin.details_json = '{}'
     AND origin.created_at_ms = incident.detected_at_ms
    JOIN model_failover_events current
      ON current.event_id = incident.last_event_id
     AND current.role = incident.role
     AND current.binding_revision = incident.desired_revision
     AND current.row_version = incident.row_version
     AND current.episode_id = incident.episode_id
     AND current.actor = 'system:binding-integrity'
     AND current.policy_version = incident.policy_version
     AND current.state_after = 'DETECTED'
     AND current.desired_model_name = origin.desired_model_name
     AND current.desired_digest_sha256 = origin.desired_digest_sha256
     AND current.fallback_model_name IS NULL
     AND current.fallback_canonical_name IS NULL
     AND current.fallback_digest_sha256 IS NULL
     AND current.proof_id IS NULL
     AND current.verified = 0
     AND current.failure_phase IS NULL
     AND current.details_json = '{}'
     AND current.created_at_ms = incident.updated_at_ms
    WHERE incident.state = 'DETECTED'
      AND incident.active_failover = 0
      AND incident.policy_version = 'd-plus-v1'
      AND incident.actor = 'system:binding-integrity'
      AND incident.reason_code = 'BOUND_MODEL_NOT_INSTALLED'
      AND incident.fallback_model_name IS NULL
      AND incident.fallback_canonical_name IS NULL
      AND incident.fallback_digest_sha256 IS NULL
      AND incident.proof_id IS NULL
      AND incident.active_event_id IS NULL
      AND incident.failure_phase IS NULL
      AND incident.proof_verified_at_ms IS NULL
      AND incident.activated_at_ms IS NULL
      AND incident.resolved_at_ms IS NULL
      AND 1 = (
        SELECT COUNT(*)
        FROM model_failover_events origin_count
        WHERE origin_count.event_type = 'DETECTED'
          AND origin_count.role = incident.role
          AND origin_count.binding_revision = incident.desired_revision
          AND origin_count.row_version = 1
          AND origin_count.episode_id = incident.episode_id
      )
      AND (
        (incident.claim_operation_id IS NULL
          AND incident.claim_token IS NULL
          AND incident.claim_kind IS NULL
          AND incident.claim_started_at_ms IS NULL
          AND incident.claim_expires_at_ms IS NULL
          AND incident.row_version = 1
          AND current.event_id = origin.event_id
          AND current.event_type = 'DETECTED'
          AND current.operation_id IS NULL
          AND current.reason_code = 'BOUND_MODEL_NOT_INSTALLED'
          AND current.state_before IS NULL
          AND incident.updated_at_ms = incident.detected_at_ms)
        OR
        (incident.claim_operation_id IS NOT NULL
          AND incident.claim_token IS NOT NULL
          AND incident.claim_kind = 'ACTIVATE'
          AND incident.claim_started_at_ms IS NOT NULL
          AND incident.claim_expires_at_ms > incident.claim_started_at_ms
          AND current.event_type = 'ACTIVATION_CLAIMED'
          AND current.operation_id = incident.claim_operation_id
          AND current.reason_code = 'FAILOVER_OPERATION_CLAIMED'
          AND current.state_before = 'DETECTED'
          AND current.created_at_ms = incident.claim_started_at_ms)
        OR
        (incident.claim_operation_id IS NULL
          AND incident.claim_token IS NULL
          AND incident.claim_kind IS NULL
          AND incident.claim_started_at_ms IS NULL
          AND incident.claim_expires_at_ms IS NULL
          AND incident.row_version > 1
          AND current.event_type = 'CLAIM_EXPIRED'
          AND current.operation_id IS NOT NULL
          AND current.reason_code = 'EXPIRED_CLAIM_RELEASED'
          AND current.state_before = 'DETECTED'
          AND EXISTS (
            SELECT 1
            FROM model_failover_events claimed
            WHERE claimed.event_type = 'ACTIVATION_CLAIMED'
              AND claimed.operation_id = current.operation_id
              AND claimed.role = incident.role
              AND claimed.binding_revision = incident.desired_revision
              AND claimed.row_version = incident.row_version - 1
              AND claimed.episode_id = incident.episode_id
              AND claimed.actor = 'system:binding-integrity'
              AND claimed.reason_code = 'FAILOVER_OPERATION_CLAIMED'
              AND claimed.policy_version = incident.policy_version
              AND claimed.state_before = 'DETECTED'
              AND claimed.state_after = 'DETECTED'
              AND claimed.desired_model_name = origin.desired_model_name
              AND claimed.desired_digest_sha256 = origin.desired_digest_sha256
              AND claimed.fallback_model_name IS NULL
              AND claimed.fallback_canonical_name IS NULL
              AND claimed.fallback_digest_sha256 IS NULL
              AND claimed.proof_id IS NULL
              AND claimed.verified = 0
              AND claimed.failure_phase IS NULL
              AND claimed.details_json = '{}'
              AND claimed.created_at_ms < current.created_at_ms
          ))
      )
/* model_failover_manual_supersede_eligible(role,desired_revision,episode_id,row_version,policy_version,updated_at_ms,last_event_id,desired_model_name,desired_digest_sha256) */;
CREATE TRIGGER trg_model_failover_state_manual_supersede
    BEFORE UPDATE ON model_failover_state
    WHEN NEW.state = 'SUPERSEDED_BY_USER' AND NOT EXISTS (
      SELECT 1
      FROM model_binding_operations operation
      JOIN model_failover_manual_supersede_eligible eligible
        ON eligible.role = OLD.role
       AND eligible.desired_revision = OLD.desired_revision
       AND eligible.episode_id = OLD.episode_id
       AND eligible.row_version = OLD.row_version
       AND eligible.policy_version = OLD.policy_version
       AND eligible.updated_at_ms = OLD.updated_at_ms
       AND eligible.last_event_id = OLD.last_event_id
       AND eligible.desired_model_name = operation.previous_model_name
       AND eligible.desired_digest_sha256 = operation.previous_digest_sha256
      JOIN model_failover_events event
        ON event.event_type = 'SUPERSEDED_BY_USER'
       AND event.operation_id = operation.operation_id
       AND event.role = operation.role
       AND event.binding_revision = operation.committed_binding_revision
       AND event.row_version = NEW.row_version
       AND event.episode_id = NEW.episode_id
       AND event.actor = operation.actor
       AND event.reason_code = 'USER_BINDING_SUPERSEDED_FAILOVER'
       AND event.policy_version = operation.policy_version
       AND event.state_before = OLD.state
       AND event.state_after = 'SUPERSEDED_BY_USER'
       AND event.desired_model_name = operation.target_model_name
       AND event.desired_digest_sha256 = operation.target_digest_sha256
       AND event.fallback_model_name IS OLD.fallback_model_name
       AND event.fallback_canonical_name IS OLD.fallback_canonical_name
       AND event.fallback_digest_sha256 IS OLD.fallback_digest_sha256
       AND event.proof_id IS OLD.proof_id
       AND event.verified = 0
       AND event.failure_phase IS NULL
       AND event.details_json = '{}'
       AND event.created_at_ms = operation.created_at_ms
      JOIN model_desired_bindings desired
        ON desired.role = operation.role
       AND desired.binding_revision = operation.committed_binding_revision
       AND desired.model_name = operation.target_model_name
       AND desired.canonical_name = operation.target_canonical_name
       AND desired.digest_sha256 = operation.target_digest_sha256
       AND desired.source = operation.operation_kind
       AND desired.actor = operation.actor
       AND desired.last_event_id = operation.desired_event_id
       AND desired.observed_at_ms = operation.created_at_ms
       AND desired.updated_at_ms = operation.created_at_ms
      WHERE operation.role = OLD.role
        AND operation.expected_binding_revision = OLD.desired_revision
        AND operation.committed_binding_revision = NEW.desired_revision
        AND operation.policy_version = OLD.policy_version
        AND operation.created_at_ms >= OLD.updated_at_ms
        AND NEW.desired_revision = OLD.desired_revision + 1
        AND OLD.state = 'DETECTED'
        AND OLD.active_failover = 0
        AND OLD.actor = 'system:binding-integrity'
        AND OLD.reason_code = 'BOUND_MODEL_NOT_INSTALLED'
        AND OLD.fallback_model_name IS NULL
        AND OLD.fallback_canonical_name IS NULL
        AND OLD.fallback_digest_sha256 IS NULL
        AND OLD.proof_id IS NULL
        AND OLD.active_event_id IS NULL
        AND OLD.failure_phase IS NULL
        AND OLD.proof_verified_at_ms IS NULL
        AND OLD.activated_at_ms IS NULL
        AND OLD.resolved_at_ms IS NULL
        AND (
          (OLD.claim_operation_id IS NULL
            AND OLD.claim_token IS NULL
            AND OLD.claim_kind IS NULL
            AND OLD.claim_started_at_ms IS NULL
            AND OLD.claim_expires_at_ms IS NULL)
          OR
          (OLD.claim_operation_id IS NOT NULL
            AND OLD.claim_token IS NOT NULL
            AND OLD.claim_kind = 'ACTIVATE'
            AND OLD.claim_started_at_ms IS NOT NULL
            AND OLD.claim_expires_at_ms IS NOT NULL)
        )
        AND NEW.role = OLD.role
        AND NEW.episode_id = OLD.episode_id
        AND NEW.row_version = OLD.row_version + 1
        AND NEW.active_failover = 0
        AND NEW.fallback_model_name IS NULL
        AND NEW.fallback_canonical_name IS NULL
        AND NEW.fallback_digest_sha256 IS NULL
        AND NEW.proof_id IS NULL
        AND NEW.active_event_id IS NULL
        AND NEW.policy_version = OLD.policy_version
        AND NEW.actor = operation.actor
        AND NEW.reason_code = 'USER_BINDING_SUPERSEDED_FAILOVER'
        AND NEW.failure_phase IS NULL
        AND NEW.proof_verified_at_ms IS NULL
        AND NEW.claim_operation_id IS NULL
        AND NEW.claim_token IS NULL
        AND NEW.claim_kind IS NULL
        AND NEW.claim_started_at_ms IS NULL
        AND NEW.claim_expires_at_ms IS NULL
        AND NEW.detected_at_ms = OLD.detected_at_ms
        AND NEW.activated_at_ms IS OLD.activated_at_ms
        AND NEW.resolved_at_ms = operation.created_at_ms
        AND NEW.updated_at_ms = operation.created_at_ms
        AND NEW.last_event_id = event.event_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'MODEL_BINDING_SUPERSEDE_STATE_LINEAGE_MISMATCH: manual incident supersede requires exact operation and audit lineage');
    END;
CREATE TRIGGER trg_model_failover_state_manual_supersede_insert
    BEFORE INSERT ON model_failover_state
    WHEN NEW.state = 'SUPERSEDED_BY_USER'
    BEGIN
      SELECT RAISE(ABORT, 'superseded incident must transition from an existing detected row');
    END;
CREATE TRIGGER trg_model_failover_state_terminal_immutable
    BEFORE UPDATE ON model_failover_state
    WHEN OLD.state IN ('RESTORED','SUPERSEDED_BY_USER')
    BEGIN
      SELECT RAISE(ABORT, 'terminal failover state is immutable');
    END;
CREATE TRIGGER trg_model_failover_state_delete_authority
    BEFORE DELETE ON model_failover_state
    WHEN NOT EXISTS (
      SELECT 1
      FROM model_failover_events event
      JOIN model_desired_bindings desired
        ON desired.role = OLD.role
       AND desired.binding_revision = OLD.desired_revision
       AND desired.model_name = event.desired_model_name
       AND desired.digest_sha256 = event.desired_digest_sha256
      WHERE event.event_id = OLD.last_event_id
        AND event.role = OLD.role
        AND event.binding_revision = OLD.desired_revision
        AND event.row_version = OLD.row_version
        AND event.episode_id = OLD.episode_id
        AND event.state_after = OLD.state
        AND event.policy_version = OLD.policy_version
        AND event.actor = OLD.actor
        AND event.reason_code = OLD.reason_code
        AND event.created_at_ms = OLD.updated_at_ms
        AND event.failure_phase IS NULL
        AND OLD.state = 'SUPERSEDED_BY_USER'
        AND OLD.active_failover = 0
        AND OLD.claim_operation_id IS NULL
        AND OLD.claim_token IS NULL
        AND OLD.claim_kind IS NULL
        AND OLD.claim_started_at_ms IS NULL
        AND OLD.claim_expires_at_ms IS NULL
        AND OLD.resolved_at_ms IS NOT NULL
        AND event.event_type = 'SUPERSEDED_BY_USER'
        AND event.state_before = 'DETECTED'
        AND event.verified = 0
        AND event.proof_id IS NULL
        AND event.fallback_model_name IS NULL
        AND event.fallback_canonical_name IS NULL
        AND event.fallback_digest_sha256 IS NULL
        AND event.details_json = '{}'
        AND EXISTS (
          SELECT 1
          FROM model_binding_operations operation
          WHERE operation.operation_id = event.operation_id
            AND operation.role = OLD.role
            AND operation.committed_binding_revision = OLD.desired_revision
            AND operation.target_model_name = desired.model_name
            AND operation.target_canonical_name = desired.canonical_name
            AND operation.target_digest_sha256 = desired.digest_sha256
            AND operation.actor = event.actor
            AND operation.policy_version = event.policy_version
            AND operation.created_at_ms = event.created_at_ms
        )
    )
    BEGIN
      SELECT RAISE(ABORT, 'failover state cannot be deleted outside audited terminal retirement');
    END;
CREATE TRIGGER trg_model_binding_application_append_only_delete
    BEFORE DELETE ON model_binding_application_attempts
    BEGIN
      SELECT RAISE(ABORT, 'model_binding_application_attempts is append-only');
    END;
CREATE TRIGGER trg_model_overrides_manual_identity_insert
    BEFORE INSERT ON model_overrides
    WHEN NEW.binding_operation_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM model_binding_operations operation
      WHERE operation.operation_id = NEW.binding_operation_id
        AND operation.role = NEW.role
        AND operation.target_model_name = NEW.model
        AND operation.target_canonical_name = NEW.model_canonical_name
        AND operation.target_digest_sha256 = NEW.model_digest_sha256
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_OVERRIDE_IDENTITY_MISMATCH: override requires exact operation target');
    END;
CREATE TRIGGER trg_model_overrides_legacy_cannot_replace_manual
    BEFORE INSERT ON model_overrides
    WHEN NEW.binding_operation_id IS NULL AND EXISTS (
      SELECT 1 FROM model_overrides existing
      WHERE existing.role = NEW.role AND existing.binding_operation_id IS NOT NULL
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_OVERRIDE_LEGACY_OVERWRITE_REJECTED: legacy writer cannot replace manual lineage');
    END;
CREATE TRIGGER trg_model_overrides_manual_identity_update
    BEFORE UPDATE ON model_overrides
    WHEN NEW.binding_operation_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM model_binding_operations operation
      WHERE operation.operation_id = NEW.binding_operation_id
        AND operation.role = NEW.role
        AND operation.target_model_name = NEW.model
        AND operation.target_canonical_name = NEW.model_canonical_name
        AND operation.target_digest_sha256 = NEW.model_digest_sha256
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_OVERRIDE_IDENTITY_MISMATCH: override requires exact operation target');
    END;
CREATE TRIGGER trg_model_overrides_manual_lineage_update
    BEFORE UPDATE ON model_overrides
    WHEN OLD.binding_operation_id IS NOT NULL AND NEW.binding_operation_id IS NULL
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_OVERRIDE_LEGACY_OVERWRITE_REJECTED: manual lineage cannot become legacy');
    END;
CREATE TRIGGER trg_model_overrides_manual_lineage_delete
    BEFORE DELETE ON model_overrides
    WHEN OLD.binding_operation_id IS NOT NULL
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_OVERRIDE_MANUAL_DELETE_REJECTED: manual override is append-only through operations');
    END;
CREATE TRIGGER trg_model_overrides_verified_authority_insert
    BEFORE INSERT ON model_overrides
    WHEN NEW.verified = 1 AND NOT EXISTS (
      SELECT 1
      FROM model_binding_application_attempts attempt
      WHERE attempt.operation_id = NEW.binding_operation_id
        AND attempt.attempt_kind = 'VERIFICATION'
        AND attempt.outcome = 'SUCCEEDED'
        AND attempt.observed_canonical_name = NEW.model_canonical_name
        AND attempt.observed_digest_sha256 = NEW.model_digest_sha256
        AND attempt.attempt_revision > COALESCE((
          SELECT MAX(runtime.attempt_revision)
          FROM model_binding_application_attempts runtime
          WHERE runtime.operation_id = NEW.binding_operation_id
            AND runtime.attempt_kind IN ('RUNTIME_APPLY','STARTUP_REHYDRATE')
        ), 0)
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_OVERRIDE_VERIFICATION_REQUIRED: verified override requires exact successful probe');
    END;
CREATE TRIGGER trg_model_overrides_verified_authority_update
    BEFORE UPDATE ON model_overrides
    WHEN NEW.verified = 1 AND NOT EXISTS (
      SELECT 1
      FROM model_binding_application_attempts attempt
      WHERE attempt.operation_id = NEW.binding_operation_id
        AND attempt.attempt_kind = 'VERIFICATION'
        AND attempt.outcome = 'SUCCEEDED'
        AND attempt.observed_canonical_name = NEW.model_canonical_name
        AND attempt.observed_digest_sha256 = NEW.model_digest_sha256
        AND attempt.attempt_revision > COALESCE((
          SELECT MAX(runtime.attempt_revision)
          FROM model_binding_application_attempts runtime
          WHERE runtime.operation_id = NEW.binding_operation_id
            AND runtime.attempt_kind IN ('RUNTIME_APPLY','STARTUP_REHYDRATE')
        ), 0)
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_OVERRIDE_VERIFICATION_REQUIRED: verified override requires exact successful probe');
    END;
CREATE TRIGGER trg_model_binding_application_append_only_update
    BEFORE UPDATE ON model_binding_application_attempts
    BEGIN
      SELECT RAISE(ABORT, 'model_binding_application_attempts is append-only');
    END;
CREATE TRIGGER trg_model_binding_user_noop_provider_prefix
    AFTER INSERT ON model_binding_user_noop_receipts
    BEGIN
      INSERT INTO model_binding_user_noop_provider_supersedes (
        receipt_id, provider_operation_id
      )
      SELECT NEW.receipt_id, provider.operation_id
      FROM model_binding_provider_operations provider
      JOIN model_binding_provider_attempts terminal
        ON terminal.operation_id = provider.operation_id
      LEFT JOIN model_binding_operations binding
        ON binding.request_key = provider.request_key
      WHERE provider.role = NEW.role
        AND provider.request_purpose = 'USER_APPLY_TARGET'
        AND provider.expected_binding_revision = NEW.binding_revision
        AND provider.command_seq <= NEW.provider_command_cutoff_seq
        AND terminal.created_at_ms <= NEW.created_at_ms
        AND binding.operation_id IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM model_binding_user_noop_provider_supersedes superseded
          WHERE superseded.provider_operation_id = provider.operation_id
        );
    END;
CREATE TRIGGER trg_model_binding_user_noop_provider_supersedes_update
    BEFORE UPDATE ON model_binding_user_noop_provider_supersedes
    BEGIN
      SELECT RAISE(ABORT, 'model_binding_user_noop_provider_supersedes is append-only');
    END;
CREATE TRIGGER trg_model_binding_user_noop_provider_supersedes_delete
    BEFORE DELETE ON model_binding_user_noop_provider_supersedes
    BEGIN
      SELECT RAISE(ABORT, 'model_binding_user_noop_provider_supersedes is append-only');
    END;
CREATE TRIGGER trg_model_desired_binding_provider_unresolved_success
    BEFORE UPDATE ON model_desired_bindings
    WHEN NOT (
      NEW.role IS OLD.role
      AND NEW.model_name IS OLD.model_name
      AND NEW.canonical_name IS OLD.canonical_name
      AND NEW.digest_sha256 IS OLD.digest_sha256
      AND NEW.binding_revision IS OLD.binding_revision
      AND NEW.source IS OLD.source
      AND NEW.actor IS OLD.actor
      AND NEW.observed_at_ms IS OLD.observed_at_ms
      AND NEW.updated_at_ms IS OLD.updated_at_ms
      AND NEW.last_event_id IS OLD.last_event_id
    ) AND EXISTS (
      SELECT 1
      FROM model_binding_provider_operations provider
      JOIN model_binding_provider_attempts terminal
        ON terminal.operation_id = provider.operation_id
      LEFT JOIN model_binding_operations binding
        ON binding.request_key = provider.request_key
      WHERE provider.role = OLD.role
        AND provider.request_purpose = 'USER_APPLY_TARGET'
        AND provider.expected_binding_revision = OLD.binding_revision
        AND terminal.outcome IN ('SUCCEEDED','RECONCILED_PRESENT')
        AND binding.operation_id IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM model_binding_user_noop_provider_supersedes superseded
          WHERE superseded.provider_operation_id = provider.operation_id
        )
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_PROVIDER_UNRESOLVED_SUCCESS: desired projection cannot change before provider success closure');
    END;
CREATE TRIGGER trg_model_desired_binding_provider_pending
    BEFORE UPDATE ON model_desired_bindings
    WHEN NOT (
      NEW.role IS OLD.role
      AND NEW.model_name IS OLD.model_name
      AND NEW.canonical_name IS OLD.canonical_name
      AND NEW.digest_sha256 IS OLD.digest_sha256
      AND NEW.binding_revision IS OLD.binding_revision
      AND NEW.source IS OLD.source
      AND NEW.actor IS OLD.actor
      AND NEW.observed_at_ms IS OLD.observed_at_ms
      AND NEW.updated_at_ms IS OLD.updated_at_ms
      AND NEW.last_event_id IS OLD.last_event_id
    ) AND EXISTS (
      SELECT 1
      FROM model_binding_provider_operations provider
      LEFT JOIN model_binding_provider_attempts terminal
        ON terminal.operation_id = provider.operation_id
      WHERE provider.role = OLD.role
        AND provider.request_purpose = 'USER_APPLY_TARGET'
        AND provider.expected_binding_revision = OLD.binding_revision
        AND terminal.operation_id IS NULL
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_PROVIDER_OPERATION_IN_PROGRESS: desired projection cannot change during a live provider command');
    END;
CREATE TRIGGER trg_model_desired_binding_provider_unresolved_insert
    BEFORE INSERT ON model_desired_bindings
    WHEN EXISTS (
      SELECT 1
      FROM model_desired_bindings current
      JOIN model_binding_provider_operations provider
        ON provider.role = current.role
       AND provider.request_purpose = 'USER_APPLY_TARGET'
       AND provider.expected_binding_revision = current.binding_revision
      JOIN model_binding_provider_attempts terminal
        ON terminal.operation_id = provider.operation_id
      LEFT JOIN model_binding_operations binding
        ON binding.request_key = provider.request_key
      WHERE current.role = NEW.role
        AND terminal.outcome IN ('SUCCEEDED','RECONCILED_PRESENT')
        AND binding.operation_id IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM model_binding_user_noop_provider_supersedes superseded
          WHERE superseded.provider_operation_id = provider.operation_id
        )
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_PROVIDER_UNRESOLVED_SUCCESS: desired projection cannot be replaced before provider success closure');
    END;
CREATE TRIGGER trg_model_desired_binding_provider_pending_insert
    BEFORE INSERT ON model_desired_bindings
    WHEN EXISTS (
      SELECT 1
      FROM model_desired_bindings current
      JOIN model_binding_provider_operations provider
        ON provider.role = current.role
       AND provider.request_purpose = 'USER_APPLY_TARGET'
       AND provider.expected_binding_revision = current.binding_revision
      LEFT JOIN model_binding_provider_attempts terminal
        ON terminal.operation_id = provider.operation_id
      WHERE current.role = NEW.role
        AND terminal.operation_id IS NULL
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_PROVIDER_OPERATION_IN_PROGRESS: desired projection cannot be replaced during a live provider command');
    END;
CREATE TRIGGER trg_model_desired_binding_provider_unresolved_delete
    BEFORE DELETE ON model_desired_bindings
    WHEN EXISTS (
      SELECT 1
      FROM model_binding_provider_operations provider
      JOIN model_binding_provider_attempts terminal
        ON terminal.operation_id = provider.operation_id
      LEFT JOIN model_binding_operations binding
        ON binding.request_key = provider.request_key
      WHERE provider.role = OLD.role
        AND provider.request_purpose = 'USER_APPLY_TARGET'
        AND provider.expected_binding_revision = OLD.binding_revision
        AND terminal.outcome IN ('SUCCEEDED','RECONCILED_PRESENT')
        AND binding.operation_id IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM model_binding_user_noop_provider_supersedes superseded
          WHERE superseded.provider_operation_id = provider.operation_id
        )
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_PROVIDER_UNRESOLVED_SUCCESS: desired projection cannot be deleted before provider success closure');
    END;
CREATE TRIGGER trg_model_desired_binding_provider_pending_delete
    BEFORE DELETE ON model_desired_bindings
    WHEN EXISTS (
      SELECT 1
      FROM model_binding_provider_operations provider
      LEFT JOIN model_binding_provider_attempts terminal
        ON terminal.operation_id = provider.operation_id
      WHERE provider.role = OLD.role
        AND provider.request_purpose = 'USER_APPLY_TARGET'
        AND provider.expected_binding_revision = OLD.binding_revision
        AND terminal.operation_id IS NULL
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_PROVIDER_OPERATION_IN_PROGRESS: desired projection cannot be deleted during a live provider command');
    END;
CREATE TRIGGER trg_model_binding_user_noop_append_only_update
    BEFORE UPDATE ON model_binding_user_noop_receipts
    BEGIN
      SELECT RAISE(ABORT, 'model_binding_user_noop_receipts is append-only');
    END;
CREATE TRIGGER trg_model_binding_user_noop_append_only_delete
    BEFORE DELETE ON model_binding_user_noop_receipts
    BEGIN
      SELECT RAISE(ABORT, 'model_binding_user_noop_receipts is append-only');
    END;
CREATE TRIGGER trg_model_binding_provider_claim_create
    AFTER INSERT ON model_binding_provider_operations
    BEGIN
      INSERT INTO model_binding_provider_claims (
        operation_id, role, provider_origin, requested_canonical_name,
        claim_token, fencing_revision, lease_expires_at_ms, updated_at_ms
      ) VALUES (
        NEW.operation_id, NEW.role, NEW.provider_origin, NEW.requested_canonical_name,
        NEW.initial_claim_token, 1, NEW.initial_claim_expires_at_ms, NEW.created_at_ms
      );
    END;
CREATE TRIGGER trg_model_binding_provider_claim_update_guard
    BEFORE UPDATE ON model_binding_provider_claims
    WHEN NOT (
      OLD.operation_id = NEW.operation_id
      AND OLD.role = NEW.role
      AND OLD.provider_origin = NEW.provider_origin
      AND OLD.requested_canonical_name = NEW.requested_canonical_name
      AND NEW.lease_expires_at_ms > NEW.updated_at_ms
      AND (
        (NEW.claim_token = OLD.claim_token
          AND NEW.fencing_revision = OLD.fencing_revision
          AND NEW.updated_at_ms >= OLD.updated_at_ms
          AND NEW.updated_at_ms <= OLD.lease_expires_at_ms
          AND NEW.lease_expires_at_ms > OLD.lease_expires_at_ms)
        OR
        (NEW.claim_token <> OLD.claim_token
          AND NEW.fencing_revision = OLD.fencing_revision + 1
          AND OLD.lease_expires_at_ms < NEW.updated_at_ms)
      )
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_PROVIDER_CLAIM_INVALID: invalid heartbeat or fenced takeover');
    END;
CREATE TRIGGER trg_model_binding_provider_claim_delete_guard
    BEFORE DELETE ON model_binding_provider_claims
    WHEN NOT EXISTS (
      SELECT 1 FROM model_binding_provider_attempts terminal
      WHERE terminal.operation_id = OLD.operation_id
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_PROVIDER_CLAIM_ACTIVE: claim cannot be released before terminal audit');
    END;
CREATE TRIGGER trg_model_binding_provider_claim_release
    AFTER INSERT ON model_binding_provider_attempts
    BEGIN
      DELETE FROM model_binding_provider_claims
      WHERE operation_id = NEW.operation_id
        AND claim_token = NEW.claim_token
        AND fencing_revision = NEW.fencing_revision;
    END;
CREATE TRIGGER trg_model_binding_provider_operations_append_only_update
    BEFORE UPDATE ON model_binding_provider_operations
    BEGIN
      SELECT RAISE(ABORT, 'model_binding_provider_operations is append-only');
    END;
CREATE TRIGGER trg_model_binding_provider_operations_append_only_delete
    BEFORE DELETE ON model_binding_provider_operations
    BEGIN
      SELECT RAISE(ABORT, 'model_binding_provider_operations is append-only');
    END;
CREATE TRIGGER trg_model_binding_provider_attempts_append_only_update
    BEFORE UPDATE ON model_binding_provider_attempts
    BEGIN
      SELECT RAISE(ABORT, 'model_binding_provider_attempts is append-only');
    END;
CREATE TRIGGER trg_model_binding_provider_attempts_append_only_delete
    BEFORE DELETE ON model_binding_provider_attempts
    BEGIN
      SELECT RAISE(ABORT, 'model_binding_provider_attempts is append-only');
    END;
CREATE TRIGGER trg_model_binding_provider_claims_insert_forbidden
    BEFORE INSERT ON model_binding_provider_claims
    WHEN EXISTS (
      SELECT 1
      FROM model_binding_provider_attempts terminal
      WHERE terminal.operation_id = NEW.operation_id
    ) OR NOT EXISTS (
      SELECT 1
      FROM model_binding_provider_operations operation
      WHERE operation.operation_id = NEW.operation_id
        AND operation.role = NEW.role
        AND operation.provider_origin = NEW.provider_origin
        AND operation.requested_canonical_name = NEW.requested_canonical_name
        AND operation.initial_claim_token = NEW.claim_token
        AND NEW.fencing_revision = 1
        AND operation.initial_claim_expires_at_ms = NEW.lease_expires_at_ms
        AND operation.created_at_ms = NEW.updated_at_ms
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_PROVIDER_CLAIM_AUTHORITY: claim must originate with provider intent');
    END;
CREATE TRIGGER trg_model_failover_events_claim_expired
    BEFORE INSERT ON model_failover_events
    WHEN NOT (NEW.seq <> -1 OR EXISTS (
      SELECT 1
      FROM model_failover_events existing
      WHERE existing.event_id = NEW.event_id
         OR (
           NEW.operation_id IS NOT NULL
           AND existing.operation_id = NEW.operation_id
           AND existing.event_type = NEW.event_type
         )
    ))
  AND (NEW.event_type = 'CLAIM_EXPIRED' AND NOT EXISTS (
      SELECT 1
      FROM model_failover_state state
      JOIN model_desired_bindings desired
        ON desired.role = state.role
       AND desired.binding_revision = state.desired_revision
      WHERE state.role = NEW.role
        AND state.desired_revision = NEW.binding_revision
        AND state.episode_id = NEW.episode_id
        AND state.row_version + 1 = NEW.row_version
        AND state.claim_operation_id = NEW.operation_id
        AND state.claim_token IS NOT NULL
        AND state.claim_expires_at_ms < NEW.created_at_ms
        AND state.policy_version = NEW.policy_version
        AND NEW.actor = 'system:binding-integrity'
        AND NEW.reason_code = 'EXPIRED_CLAIM_RELEASED'
        AND NEW.state_before = state.state
        AND NEW.state_after = state.state
        AND NEW.desired_model_name = desired.model_name
        AND NEW.desired_digest_sha256 = desired.digest_sha256
        AND NEW.fallback_model_name IS NULL
        AND NEW.fallback_canonical_name IS NULL
        AND NEW.fallback_digest_sha256 IS NULL
        AND NEW.proof_id IS NULL
        AND NEW.verified = 0
        AND NEW.failure_phase IS NULL
        AND NEW.details_json = '{}'
    ))
BEGIN
      SELECT RAISE(ABORT, 'expired claim event requires matching expired claim');
    END;
CREATE TRIGGER trg_model_failover_events_manual_supersede
    BEFORE INSERT ON model_failover_events
    WHEN NOT (NEW.seq <> -1 OR EXISTS (
      SELECT 1
      FROM model_failover_events existing
      WHERE existing.event_id = NEW.event_id
         OR (
           NEW.operation_id IS NOT NULL
           AND existing.operation_id = NEW.operation_id
           AND existing.event_type = NEW.event_type
         )
    ))
  AND (NEW.event_type = 'SUPERSEDED_BY_USER' AND NOT EXISTS (
      SELECT 1
      FROM model_binding_operations operation
      JOIN model_failover_manual_supersede_eligible eligible
        ON eligible.role = operation.role
       AND eligible.desired_revision = operation.expected_binding_revision
       AND eligible.desired_model_name = operation.previous_model_name
       AND eligible.desired_digest_sha256 = operation.previous_digest_sha256
       AND eligible.policy_version = operation.policy_version
      JOIN model_desired_bindings desired
        ON desired.role = operation.role
       AND desired.binding_revision = operation.committed_binding_revision
       AND desired.model_name = operation.target_model_name
       AND desired.canonical_name = operation.target_canonical_name
       AND desired.digest_sha256 = operation.target_digest_sha256
       AND desired.source = operation.operation_kind
       AND desired.actor = operation.actor
       AND desired.last_event_id = operation.desired_event_id
       AND desired.observed_at_ms = operation.created_at_ms
       AND desired.updated_at_ms = operation.created_at_ms
      WHERE operation.operation_id = NEW.operation_id
        AND operation.role = NEW.role
        AND operation.committed_binding_revision = NEW.binding_revision
        AND NEW.row_version = eligible.row_version + 1
        AND NEW.episode_id = eligible.episode_id
        AND NEW.actor = operation.actor
        AND NEW.reason_code = 'USER_BINDING_SUPERSEDED_FAILOVER'
        AND NEW.policy_version = operation.policy_version
        AND NEW.state_before = 'DETECTED'
        AND NEW.state_after = 'SUPERSEDED_BY_USER'
        AND NEW.desired_model_name = operation.target_model_name
        AND NEW.desired_digest_sha256 = operation.target_digest_sha256
        AND NEW.fallback_model_name IS NULL
        AND NEW.fallback_canonical_name IS NULL
        AND NEW.fallback_digest_sha256 IS NULL
        AND NEW.proof_id IS NULL
        AND NEW.verified = 0
        AND NEW.failure_phase IS NULL
        AND NEW.details_json = '{}'
        AND NEW.created_at_ms = operation.created_at_ms
        AND operation.created_at_ms >= eligible.updated_at_ms
    ))
BEGIN
      SELECT RAISE(ABORT, 'manual supersede event requires exact operation, desired projection and incident');
    END;
CREATE TRIGGER trg_model_failover_events_terminal_claim
    BEFORE INSERT ON model_failover_events
    WHEN NOT (NEW.seq <> -1 OR EXISTS (
      SELECT 1
      FROM model_failover_events existing
      WHERE existing.event_id = NEW.event_id
         OR (
           NEW.operation_id IS NOT NULL
           AND existing.operation_id = NEW.operation_id
           AND existing.event_type = NEW.event_type
         )
    ))
  AND (NEW.event_type IN ('ACTIVATED','REAPPLIED','RESTORED') AND NOT EXISTS (
      SELECT 1
      FROM model_failover_state state
      JOIN model_desired_bindings desired
        ON desired.role = state.role
       AND desired.binding_revision = state.desired_revision
      WHERE state.role = NEW.role
        AND state.desired_revision = NEW.binding_revision
        AND state.episode_id = NEW.episode_id
        AND state.row_version + 1 = NEW.row_version
        AND state.claim_operation_id = NEW.operation_id
        AND state.claim_token IS NOT NULL
        AND state.claim_started_at_ms <= NEW.created_at_ms
        AND state.claim_expires_at_ms >= NEW.created_at_ms
        AND state.policy_version = NEW.policy_version
        AND NEW.state_before = state.state
        AND NEW.desired_model_name = desired.model_name
        AND NEW.desired_digest_sha256 = desired.digest_sha256
        AND (
          (NEW.event_type = 'ACTIVATED'
            AND state.claim_kind = 'ACTIVATE'
            AND state.state = 'DETECTED'
            AND NEW.state_after = 'ACTIVATED')
          OR
          (NEW.event_type = 'REAPPLIED'
            AND state.claim_kind = 'REAPPLY'
            AND state.state = 'ACTIVATED'
            AND state.active_failover = 1
            AND NEW.state_after = 'ACTIVATED')
          OR
          (NEW.event_type = 'RESTORED'
            AND state.claim_kind = 'RESTORE'
            AND state.state = 'ACTIVATED'
            AND state.active_failover = 1
            AND NEW.state_after = 'RESTORED')
        )
    ))
BEGIN
      SELECT RAISE(ABORT, 'terminal failover event requires matching live claim');
    END;
CREATE TRIGGER trg_model_binding_operation_noop_request_conflict
    BEFORE INSERT ON model_binding_operations
    WHEN NOT (NEW.rowid <> -1 OR NEW.operation_id IS NULL OR EXISTS (
      SELECT 1
      FROM model_binding_operations existing
      WHERE existing.operation_id = NEW.operation_id
         OR existing.request_key = NEW.request_key
         OR existing.desired_event_id = NEW.desired_event_id
         OR (
           existing.role = NEW.role
           AND existing.committed_binding_revision = NEW.committed_binding_revision
         )
         OR (
           NEW.rollback_of_operation_id IS NOT NULL
           AND existing.rollback_of_operation_id = NEW.rollback_of_operation_id
         )
    ))
  AND (EXISTS (
      SELECT 1 FROM model_binding_user_noop_receipts receipt
      WHERE receipt.request_key = NEW.request_key
    ))
BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_USER_NOOP_REQUEST_CONFLICT: request key already owns a no-op receipt');
    END;
CREATE TRIGGER trg_model_binding_operation_provider_lineage
    BEFORE INSERT ON model_binding_operations
    WHEN NOT (NEW.rowid <> -1 OR NEW.operation_id IS NULL OR EXISTS (
      SELECT 1
      FROM model_binding_operations existing
      WHERE existing.operation_id = NEW.operation_id
         OR existing.request_key = NEW.request_key
         OR existing.desired_event_id = NEW.desired_event_id
         OR (
           existing.role = NEW.role
           AND existing.committed_binding_revision = NEW.committed_binding_revision
         )
         OR (
           NEW.rollback_of_operation_id IS NOT NULL
           AND existing.rollback_of_operation_id = NEW.rollback_of_operation_id
         )
    ))
  AND (EXISTS (
      SELECT 1 FROM model_binding_provider_operations provider
      WHERE provider.request_key = NEW.request_key
    ) AND NOT EXISTS (
      SELECT 1
      FROM model_binding_provider_operations provider
      JOIN model_binding_provider_attempts terminal
        ON terminal.operation_id = provider.operation_id
      WHERE provider.request_key = NEW.request_key
        AND provider.request_purpose = 'USER_APPLY_TARGET'
        AND NEW.operation_kind = 'USER_APPLY'
        AND provider.role = NEW.role
        AND provider.expected_binding_revision = NEW.expected_binding_revision
        AND provider.actor = NEW.actor
        AND terminal.outcome IN ('SUCCEEDED','RECONCILED_PRESENT')
        AND terminal.observed_canonical_name = NEW.target_canonical_name
        AND terminal.observed_digest_sha256 = NEW.target_digest_sha256
        AND NOT EXISTS (
          SELECT 1
          FROM model_binding_user_noop_provider_supersedes superseded
          WHERE superseded.provider_operation_id = provider.operation_id
        )
    ))
BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_PROVIDER_LINEAGE_MISMATCH: binding does not match provider authority');
    END;
CREATE TRIGGER trg_model_binding_operation_provider_not_superseded
    BEFORE INSERT ON model_binding_operations
    WHEN NOT (NEW.rowid <> -1 OR NEW.operation_id IS NULL OR EXISTS (
      SELECT 1
      FROM model_binding_operations existing
      WHERE existing.operation_id = NEW.operation_id
         OR existing.request_key = NEW.request_key
         OR existing.desired_event_id = NEW.desired_event_id
         OR (
           existing.role = NEW.role
           AND existing.committed_binding_revision = NEW.committed_binding_revision
         )
         OR (
           NEW.rollback_of_operation_id IS NOT NULL
           AND existing.rollback_of_operation_id = NEW.rollback_of_operation_id
         )
    ))
  AND (EXISTS (
      SELECT 1
      FROM model_binding_provider_operations provider
      JOIN model_binding_user_noop_provider_supersedes superseded
        ON superseded.provider_operation_id = provider.operation_id
      WHERE provider.request_key = NEW.request_key
    ))
BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_PROVIDER_COMMAND_SUPERSEDED: provider command was closed by a no-op receipt');
    END;
CREATE TRIGGER trg_model_binding_operation_provider_pending
    BEFORE INSERT ON model_binding_operations
    WHEN NOT (NEW.rowid <> -1 OR NEW.operation_id IS NULL OR EXISTS (
      SELECT 1
      FROM model_binding_operations existing
      WHERE existing.operation_id = NEW.operation_id
         OR existing.request_key = NEW.request_key
         OR existing.desired_event_id = NEW.desired_event_id
         OR (
           existing.role = NEW.role
           AND existing.committed_binding_revision = NEW.committed_binding_revision
         )
         OR (
           NEW.rollback_of_operation_id IS NOT NULL
           AND existing.rollback_of_operation_id = NEW.rollback_of_operation_id
         )
    ))
  AND (EXISTS (
      SELECT 1
      FROM model_binding_provider_operations provider
      LEFT JOIN model_binding_provider_attempts terminal
        ON terminal.operation_id = provider.operation_id
      WHERE provider.role = NEW.role
        AND provider.request_purpose = 'USER_APPLY_TARGET'
        AND provider.expected_binding_revision = NEW.expected_binding_revision
        AND terminal.operation_id IS NULL
    ))
BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_PROVIDER_OPERATION_IN_PROGRESS: binding cannot change during a live provider command');
    END;
CREATE TRIGGER trg_model_binding_operation_provider_unresolved_success
    BEFORE INSERT ON model_binding_operations
    WHEN NOT (NEW.rowid <> -1 OR NEW.operation_id IS NULL OR EXISTS (
      SELECT 1
      FROM model_binding_operations existing
      WHERE existing.operation_id = NEW.operation_id
         OR existing.request_key = NEW.request_key
         OR existing.desired_event_id = NEW.desired_event_id
         OR (
           existing.role = NEW.role
           AND existing.committed_binding_revision = NEW.committed_binding_revision
         )
         OR (
           NEW.rollback_of_operation_id IS NOT NULL
           AND existing.rollback_of_operation_id = NEW.rollback_of_operation_id
         )
    ))
  AND (EXISTS (
      SELECT 1
      FROM model_binding_provider_operations provider
      JOIN model_binding_provider_attempts terminal
        ON terminal.operation_id = provider.operation_id
      LEFT JOIN model_binding_operations binding
        ON binding.request_key = provider.request_key
      WHERE provider.role = NEW.role
        AND provider.request_purpose = 'USER_APPLY_TARGET'
        AND provider.expected_binding_revision = NEW.expected_binding_revision
        AND terminal.outcome IN ('SUCCEEDED','RECONCILED_PRESENT')
        AND binding.operation_id IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM model_binding_user_noop_provider_supersedes superseded
          WHERE superseded.provider_operation_id = provider.operation_id
        )
        AND NOT (
          NEW.operation_kind = 'USER_APPLY'
          AND provider.request_key = NEW.request_key
          AND provider.actor = NEW.actor
          AND terminal.observed_canonical_name = NEW.target_canonical_name
          AND terminal.observed_digest_sha256 = NEW.target_digest_sha256
        )
    ))
BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_PROVIDER_UNRESOLVED_SUCCESS: resolve or explicitly supersede the earlier provider success before changing the binding');
    END;
CREATE TRIGGER trg_model_binding_operations_audit_event
    BEFORE INSERT ON model_binding_operations
    WHEN NOT (NEW.rowid <> -1 OR NEW.operation_id IS NULL OR EXISTS (
      SELECT 1
      FROM model_binding_operations existing
      WHERE existing.operation_id = NEW.operation_id
         OR existing.request_key = NEW.request_key
         OR existing.desired_event_id = NEW.desired_event_id
         OR (
           existing.role = NEW.role
           AND existing.committed_binding_revision = NEW.committed_binding_revision
         )
         OR (
           NEW.rollback_of_operation_id IS NOT NULL
           AND existing.rollback_of_operation_id = NEW.rollback_of_operation_id
         )
    ))
  AND (NOT EXISTS (
      SELECT 1
      FROM model_failover_events event
      WHERE event.event_id = NEW.desired_event_id
        AND event.event_type = 'DESIRED_CHANGED'
        AND event.operation_id = NEW.operation_id
        AND event.role = NEW.role
        AND event.binding_revision = NEW.committed_binding_revision
        AND event.actor = NEW.actor
        AND event.reason_code = NEW.reason_code
        AND event.policy_version = NEW.policy_version
        AND event.desired_model_name = NEW.target_model_name
        AND event.desired_digest_sha256 = NEW.target_digest_sha256
        AND event.row_version IS NULL
        AND event.episode_id IS NULL
        AND event.state_before IS NULL
        AND event.state_after IS NULL
        AND event.fallback_model_name IS NULL
        AND event.fallback_canonical_name IS NULL
        AND event.fallback_digest_sha256 IS NULL
        AND event.proof_id IS NULL
        AND event.verified = 0
        AND event.failure_phase IS NULL
        AND event.details_json = '{}'
        AND event.created_at_ms = NEW.created_at_ms
        AND (
          (NEW.operation_kind = 'USER_APPLY'
            AND NEW.reason_code = 'USER_MODEL_BINDING_APPLIED')
          OR
          (NEW.operation_kind = 'USER_ROLLBACK'
            AND NEW.reason_code = 'USER_MODEL_BINDING_ROLLED_BACK')
        )
    ))
BEGIN
      SELECT RAISE(ABORT, 'binding operation requires matching unverified audit event');
    END;
CREATE TRIGGER trg_model_binding_operations_current_projection
    BEFORE INSERT ON model_binding_operations
    WHEN NOT (NEW.rowid <> -1 OR NEW.operation_id IS NULL OR EXISTS (
      SELECT 1
      FROM model_binding_operations existing
      WHERE existing.operation_id = NEW.operation_id
         OR existing.request_key = NEW.request_key
         OR existing.desired_event_id = NEW.desired_event_id
         OR (
           existing.role = NEW.role
           AND existing.committed_binding_revision = NEW.committed_binding_revision
         )
         OR (
           NEW.rollback_of_operation_id IS NOT NULL
           AND existing.rollback_of_operation_id = NEW.rollback_of_operation_id
         )
    ))
  AND (NOT EXISTS (
      SELECT 1
      FROM model_desired_bindings desired
      WHERE desired.role = NEW.role
        AND desired.binding_revision = NEW.expected_binding_revision
        AND desired.model_name = NEW.previous_model_name
        AND desired.canonical_name = NEW.previous_canonical_name
        AND desired.digest_sha256 = NEW.previous_digest_sha256
    ))
BEGIN
      SELECT RAISE(ABORT, 'binding operation requires matching current desired projection');
    END;
CREATE TRIGGER trg_model_binding_operations_manual_predecessor
    BEFORE INSERT ON model_binding_operations
    WHEN NOT (NEW.rowid <> -1 OR NEW.operation_id IS NULL OR EXISTS (
      SELECT 1
      FROM model_binding_operations existing
      WHERE existing.operation_id = NEW.operation_id
         OR existing.request_key = NEW.request_key
         OR existing.desired_event_id = NEW.desired_event_id
         OR (
           existing.role = NEW.role
           AND existing.committed_binding_revision = NEW.committed_binding_revision
         )
         OR (
           NEW.rollback_of_operation_id IS NOT NULL
           AND existing.rollback_of_operation_id = NEW.rollback_of_operation_id
         )
    ))
  AND (NEW.operation_kind = 'USER_APPLY'
      AND EXISTS (
        SELECT 1
        FROM model_desired_bindings desired
        WHERE desired.role = NEW.role
          AND desired.binding_revision = NEW.expected_binding_revision
          AND desired.source IN ('USER_APPLY','USER_ROLLBACK')
      )
      AND NOT EXISTS (
        SELECT 1
        FROM model_binding_operations predecessor
        WHERE predecessor.operation_id = NEW.predecessor_operation_id
          AND predecessor.role = NEW.role
          AND predecessor.committed_binding_revision = NEW.expected_binding_revision
          AND predecessor.target_model_name = NEW.previous_model_name
          AND predecessor.target_canonical_name = NEW.previous_canonical_name
          AND predecessor.target_digest_sha256 = NEW.previous_digest_sha256
      ))
BEGIN
      SELECT RAISE(ABORT, 'binding apply after a manual revision requires its exact predecessor');
    END;
CREATE TRIGGER trg_model_binding_operations_no_incident
    BEFORE INSERT ON model_binding_operations
    WHEN NOT (NEW.rowid <> -1 OR NEW.operation_id IS NULL OR EXISTS (
      SELECT 1
      FROM model_binding_operations existing
      WHERE existing.operation_id = NEW.operation_id
         OR existing.request_key = NEW.request_key
         OR existing.desired_event_id = NEW.desired_event_id
         OR (
           existing.role = NEW.role
           AND existing.committed_binding_revision = NEW.committed_binding_revision
         )
         OR (
           NEW.rollback_of_operation_id IS NOT NULL
           AND existing.rollback_of_operation_id = NEW.rollback_of_operation_id
         )
    ))
  AND (EXISTS (
      SELECT 1
      FROM model_failover_state incident
      WHERE incident.role = NEW.role
    ) AND NOT EXISTS (
      SELECT 1
      FROM model_failover_manual_supersede_eligible eligible
      JOIN model_desired_bindings desired
        ON desired.role = eligible.role
       AND desired.binding_revision = eligible.desired_revision
       AND desired.model_name = eligible.desired_model_name
       AND desired.digest_sha256 = eligible.desired_digest_sha256
      JOIN model_failover_events desired_event
        ON desired_event.event_id = NEW.desired_event_id
       AND desired_event.event_type = 'DESIRED_CHANGED'
       AND desired_event.operation_id = NEW.operation_id
       AND desired_event.role = NEW.role
       AND desired_event.binding_revision = NEW.committed_binding_revision
       AND desired_event.actor = NEW.actor
       AND desired_event.reason_code = NEW.reason_code
       AND desired_event.policy_version = NEW.policy_version
       AND desired_event.desired_model_name = NEW.target_model_name
       AND desired_event.desired_digest_sha256 = NEW.target_digest_sha256
       AND desired_event.verified = 0
       AND desired_event.created_at_ms = NEW.created_at_ms
      WHERE eligible.role = NEW.role
        AND eligible.desired_revision = NEW.expected_binding_revision
        AND eligible.policy_version = NEW.policy_version
        AND NEW.created_at_ms >= eligible.updated_at_ms
        AND desired.canonical_name = NEW.previous_canonical_name
        AND desired.model_name = NEW.previous_model_name
        AND desired.digest_sha256 = NEW.previous_digest_sha256
    ))
BEGIN
      SELECT RAISE(ABORT, 'manual binding operation requires exact atomic incident supersede');
    END;
CREATE TRIGGER trg_model_binding_operations_predecessor
    BEFORE INSERT ON model_binding_operations
    WHEN NOT (NEW.rowid <> -1 OR NEW.operation_id IS NULL OR EXISTS (
      SELECT 1
      FROM model_binding_operations existing
      WHERE existing.operation_id = NEW.operation_id
         OR existing.request_key = NEW.request_key
         OR existing.desired_event_id = NEW.desired_event_id
         OR (
           existing.role = NEW.role
           AND existing.committed_binding_revision = NEW.committed_binding_revision
         )
         OR (
           NEW.rollback_of_operation_id IS NOT NULL
           AND existing.rollback_of_operation_id = NEW.rollback_of_operation_id
         )
    ))
  AND (NEW.predecessor_operation_id IS NOT NULL
      AND NEW.operation_kind = 'USER_APPLY'
      AND NOT EXISTS (
        SELECT 1
        FROM model_binding_operations predecessor
        WHERE predecessor.operation_id = NEW.predecessor_operation_id
          AND predecessor.role = NEW.role
          AND predecessor.committed_binding_revision = NEW.expected_binding_revision
          AND predecessor.target_model_name = NEW.previous_model_name
          AND predecessor.target_canonical_name = NEW.previous_canonical_name
          AND predecessor.target_digest_sha256 = NEW.previous_digest_sha256
      ))
BEGIN
      SELECT RAISE(ABORT, 'binding apply predecessor does not match current revision');
    END;
CREATE TRIGGER trg_model_binding_operations_rollback_lineage
    BEFORE INSERT ON model_binding_operations
    WHEN NOT (NEW.rowid <> -1 OR NEW.operation_id IS NULL OR EXISTS (
      SELECT 1
      FROM model_binding_operations existing
      WHERE existing.operation_id = NEW.operation_id
         OR existing.request_key = NEW.request_key
         OR existing.desired_event_id = NEW.desired_event_id
         OR (
           existing.role = NEW.role
           AND existing.committed_binding_revision = NEW.committed_binding_revision
         )
         OR (
           NEW.rollback_of_operation_id IS NOT NULL
           AND existing.rollback_of_operation_id = NEW.rollback_of_operation_id
         )
    ))
  AND (NEW.operation_kind = 'USER_ROLLBACK' AND NOT EXISTS (
      SELECT 1
      FROM model_binding_operations applied
      WHERE applied.operation_id = NEW.rollback_of_operation_id
        AND applied.operation_id = NEW.predecessor_operation_id
        AND applied.operation_kind = 'USER_APPLY'
        AND applied.role = NEW.role
        AND applied.committed_binding_revision = NEW.expected_binding_revision
        AND applied.target_model_name = NEW.previous_model_name
        AND applied.target_canonical_name = NEW.previous_canonical_name
        AND applied.target_digest_sha256 = NEW.previous_digest_sha256
        AND applied.previous_model_name = NEW.target_model_name
        AND applied.previous_canonical_name = NEW.target_canonical_name
        AND applied.previous_digest_sha256 = NEW.target_digest_sha256
    ))
BEGIN
      SELECT RAISE(ABORT, 'binding rollback must append an exact reversal of its direct apply');
    END;
CREATE TRIGGER trg_model_binding_operations_user_actor
    BEFORE INSERT ON model_binding_operations
    WHEN NOT (NEW.rowid <> -1 OR NEW.operation_id IS NULL OR EXISTS (
      SELECT 1
      FROM model_binding_operations existing
      WHERE existing.operation_id = NEW.operation_id
         OR existing.request_key = NEW.request_key
         OR existing.desired_event_id = NEW.desired_event_id
         OR (
           existing.role = NEW.role
           AND existing.committed_binding_revision = NEW.committed_binding_revision
         )
         OR (
           NEW.rollback_of_operation_id IS NOT NULL
           AND existing.rollback_of_operation_id = NEW.rollback_of_operation_id
         )
    ))
  AND (substr(NEW.actor, 1, 5) <> 'user:' OR length(NEW.actor) <= 5
      OR instr(NEW.actor, ' ') > 0 OR instr(NEW.actor, char(9)) > 0
      OR instr(NEW.actor, char(10)) > 0 OR instr(NEW.actor, char(11)) > 0
      OR instr(NEW.actor, char(12)) > 0 OR instr(NEW.actor, char(13)) > 0
      OR instr(NEW.actor, char(160)) > 0 OR instr(NEW.actor, char(5760)) > 0
      OR instr(NEW.actor, char(8192)) > 0 OR instr(NEW.actor, char(8193)) > 0
      OR instr(NEW.actor, char(8194)) > 0 OR instr(NEW.actor, char(8195)) > 0
      OR instr(NEW.actor, char(8196)) > 0 OR instr(NEW.actor, char(8197)) > 0
      OR instr(NEW.actor, char(8198)) > 0 OR instr(NEW.actor, char(8199)) > 0
      OR instr(NEW.actor, char(8200)) > 0 OR instr(NEW.actor, char(8201)) > 0
      OR instr(NEW.actor, char(8202)) > 0 OR instr(NEW.actor, char(8232)) > 0
      OR instr(NEW.actor, char(8233)) > 0 OR instr(NEW.actor, char(8239)) > 0
      OR instr(NEW.actor, char(8287)) > 0 OR instr(NEW.actor, char(12288)) > 0
      OR instr(NEW.actor, char(65279)) > 0)
BEGIN
      SELECT RAISE(ABORT, 'manual binding operation requires a user actor');
    END;
CREATE TRIGGER trg_model_binding_application_current_desired
    BEFORE INSERT ON model_binding_application_attempts
    WHEN NOT (NEW.seq <> -1 OR EXISTS (
      SELECT 1
      FROM model_binding_application_attempts existing
      WHERE existing.seq = NEW.seq
         OR (
           existing.operation_id = NEW.operation_id
           AND existing.attempt_revision = NEW.attempt_revision
         )
    ))
  AND (NOT EXISTS (
      SELECT 1
      FROM model_binding_operations operation
      JOIN model_desired_bindings desired
        ON desired.role = operation.role
       AND desired.binding_revision = operation.committed_binding_revision
       AND desired.model_name = operation.target_model_name
       AND desired.canonical_name = operation.target_canonical_name
       AND desired.digest_sha256 = operation.target_digest_sha256
       AND desired.source = operation.operation_kind
       AND desired.actor = operation.actor
       AND desired.last_event_id = operation.desired_event_id
       AND desired.observed_at_ms = operation.created_at_ms
       AND desired.updated_at_ms = operation.created_at_ms
      WHERE operation.operation_id = NEW.operation_id
    ))
BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_APPLICATION_DESIRED_MISMATCH: operation is not current desired authority');
    END;
CREATE TRIGGER trg_model_binding_application_nonretryable_runtime_terminal
    BEFORE INSERT ON model_binding_application_attempts
    WHEN NOT (NEW.seq <> -1 OR EXISTS (
      SELECT 1
      FROM model_binding_application_attempts existing
      WHERE existing.seq = NEW.seq
         OR (
           existing.operation_id = NEW.operation_id
           AND existing.attempt_revision = NEW.attempt_revision
         )
    ))
  AND (NEW.attempt_kind IN ('RUNTIME_APPLY','STARTUP_REHYDRATE')
      AND EXISTS (
        SELECT 1
        FROM model_binding_application_attempts failed
        WHERE failed.operation_id = NEW.operation_id
          AND failed.attempt_kind IN ('RUNTIME_APPLY','STARTUP_REHYDRATE')
          AND failed.outcome = 'FAILED'
          AND failed.retryable = 0
          AND failed.attempt_revision > COALESCE((
            SELECT MAX(applied.attempt_revision)
            FROM model_binding_application_attempts applied
            WHERE applied.operation_id = NEW.operation_id
              AND applied.attempt_kind IN ('RUNTIME_APPLY','STARTUP_REHYDRATE')
              AND applied.outcome = 'SUCCEEDED'
          ), 0)
      ))
BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_APPLICATION_NONRETRYABLE_TERMINAL: no later runtime attempt is allowed without a new user operation');
    END;
CREATE TRIGGER trg_model_binding_application_notification_once
    BEFORE INSERT ON model_binding_application_attempts
    WHEN NOT (NEW.seq <> -1 OR EXISTS (
      SELECT 1
      FROM model_binding_application_attempts existing
      WHERE existing.seq = NEW.seq
         OR (
           existing.operation_id = NEW.operation_id
           AND existing.attempt_revision = NEW.attempt_revision
         )
    ))
  AND (NEW.attempt_kind = 'NOTIFICATION' AND EXISTS (
      SELECT 1
      FROM model_binding_application_attempts notification
      WHERE notification.operation_id = NEW.operation_id
        AND notification.attempt_kind = 'NOTIFICATION'
    ))
BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_APPLICATION_NOTIFICATION_TERMINAL: notification is recorded once');
    END;
CREATE TRIGGER trg_model_binding_application_revision
    BEFORE INSERT ON model_binding_application_attempts
    WHEN NOT (NEW.seq <> -1 OR EXISTS (
      SELECT 1
      FROM model_binding_application_attempts existing
      WHERE existing.seq = NEW.seq
         OR (
           existing.operation_id = NEW.operation_id
           AND existing.attempt_revision = NEW.attempt_revision
         )
    ))
  AND (NEW.attempt_revision <> COALESCE((
      SELECT MAX(existing.attempt_revision)
      FROM model_binding_application_attempts existing
      WHERE existing.operation_id = NEW.operation_id
    ), 0) + 1)
BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_APPLICATION_ATTEMPT_REVISION_MISMATCH: attempt revision must append exactly');
    END;
CREATE TRIGGER trg_model_binding_application_runtime_apply_after_rehydrate
    BEFORE INSERT ON model_binding_application_attempts
    WHEN NOT (NEW.seq <> -1 OR EXISTS (
      SELECT 1
      FROM model_binding_application_attempts existing
      WHERE existing.seq = NEW.seq
         OR (
           existing.operation_id = NEW.operation_id
           AND existing.attempt_revision = NEW.attempt_revision
         )
    ))
  AND (NEW.attempt_kind = 'RUNTIME_APPLY' AND EXISTS (
      SELECT 1
      FROM model_binding_application_attempts rehydrated
      WHERE rehydrated.operation_id = NEW.operation_id
        AND rehydrated.attempt_kind = 'STARTUP_REHYDRATE'
        AND rehydrated.outcome = 'SUCCEEDED'
    ))
BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_APPLICATION_RUNTIME_GENERATION_CLOSED: runtime apply cannot follow startup rehydrate');
    END;
CREATE TRIGGER trg_model_binding_application_runtime_apply_once
    BEFORE INSERT ON model_binding_application_attempts
    WHEN NOT (NEW.seq <> -1 OR EXISTS (
      SELECT 1
      FROM model_binding_application_attempts existing
      WHERE existing.seq = NEW.seq
         OR (
           existing.operation_id = NEW.operation_id
           AND existing.attempt_revision = NEW.attempt_revision
         )
    ))
  AND (NEW.attempt_kind = 'RUNTIME_APPLY' AND EXISTS (
      SELECT 1
      FROM model_binding_application_attempts applied
      WHERE applied.operation_id = NEW.operation_id
        AND applied.attempt_kind = 'RUNTIME_APPLY'
        AND applied.outcome = 'SUCCEEDED'
    ))
BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_APPLICATION_RUNTIME_ALREADY_APPLIED: runtime apply is terminal after success');
    END;
CREATE TRIGGER trg_model_binding_application_runtime_changed_shape
    BEFORE INSERT ON model_binding_application_attempts
    WHEN NOT (NEW.seq <> -1 OR EXISTS (
      SELECT 1
      FROM model_binding_application_attempts existing
      WHERE existing.seq = NEW.seq
         OR (
           existing.operation_id = NEW.operation_id
           AND existing.attempt_revision = NEW.attempt_revision
         )
    ))
  AND ((
      NEW.runtime_changed = 1
      AND NOT (
        NEW.attempt_kind IN ('RUNTIME_APPLY','STARTUP_REHYDRATE')
        AND NEW.outcome = 'SUCCEEDED'
      )
    ))
BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_APPLICATION_RUNTIME_CHANGED_INVALID: only successful runtime outcomes may claim a mutation');
    END;
CREATE TRIGGER trg_model_binding_application_runtime_prerequisite
    BEFORE INSERT ON model_binding_application_attempts
    WHEN NOT (NEW.seq <> -1 OR EXISTS (
      SELECT 1
      FROM model_binding_application_attempts existing
      WHERE existing.seq = NEW.seq
         OR (
           existing.operation_id = NEW.operation_id
           AND existing.attempt_revision = NEW.attempt_revision
         )
    ))
  AND (NEW.attempt_kind IN ('VERIFICATION','NOTIFICATION') AND NOT EXISTS (
      SELECT 1
      FROM model_binding_application_attempts runtime
      WHERE runtime.operation_id = NEW.operation_id
        AND runtime.attempt_kind IN ('RUNTIME_APPLY','STARTUP_REHYDRATE')
        AND runtime.outcome = 'SUCCEEDED'
        AND runtime.attempt_revision = (
          SELECT MAX(latest.attempt_revision)
          FROM model_binding_application_attempts latest
          WHERE latest.operation_id = NEW.operation_id
            AND latest.attempt_kind IN ('RUNTIME_APPLY','STARTUP_REHYDRATE')
        )
    ))
BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_APPLICATION_RUNTIME_PREREQUISITE: terminal effect requires applied runtime');
    END;
CREATE TRIGGER trg_model_binding_application_success_identity
    BEFORE INSERT ON model_binding_application_attempts
    WHEN NOT (NEW.seq <> -1 OR EXISTS (
      SELECT 1
      FROM model_binding_application_attempts existing
      WHERE existing.seq = NEW.seq
         OR (
           existing.operation_id = NEW.operation_id
           AND existing.attempt_revision = NEW.attempt_revision
         )
    ))
  AND (NEW.outcome = 'SUCCEEDED' AND NOT EXISTS (
      SELECT 1
      FROM model_binding_operations operation
      WHERE operation.operation_id = NEW.operation_id
        AND operation.target_canonical_name = NEW.observed_canonical_name
        AND operation.target_digest_sha256 = NEW.observed_digest_sha256
    ))
BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_APPLICATION_IDENTITY_MISMATCH: success requires exact target identity');
    END;
CREATE TRIGGER trg_model_binding_application_time_order
    BEFORE INSERT ON model_binding_application_attempts
    WHEN NOT (NEW.seq <> -1 OR EXISTS (
      SELECT 1
      FROM model_binding_application_attempts existing
      WHERE existing.seq = NEW.seq
         OR (
           existing.operation_id = NEW.operation_id
           AND existing.attempt_revision = NEW.attempt_revision
         )
    ))
  AND (NOT EXISTS (
      SELECT 1
      FROM model_binding_operations operation
      WHERE operation.operation_id = NEW.operation_id
        AND operation.created_at_ms <= NEW.created_at_ms
    ) OR EXISTS (
      SELECT 1
      FROM model_binding_application_attempts previous
      WHERE previous.operation_id = NEW.operation_id
        AND previous.attempt_revision = NEW.attempt_revision - 1
        AND previous.created_at_ms > NEW.created_at_ms
    ))
BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_APPLICATION_TIME_ROLLBACK: attempt time precedes its authority');
    END;
CREATE TRIGGER trg_model_binding_application_verification_terminal
    BEFORE INSERT ON model_binding_application_attempts
    WHEN NOT (NEW.seq <> -1 OR EXISTS (
      SELECT 1
      FROM model_binding_application_attempts existing
      WHERE existing.seq = NEW.seq
         OR (
           existing.operation_id = NEW.operation_id
           AND existing.attempt_revision = NEW.attempt_revision
         )
    ))
  AND (NEW.attempt_kind = 'VERIFICATION' AND EXISTS (
      SELECT 1
      FROM model_binding_application_attempts verified
      WHERE verified.operation_id = NEW.operation_id
        AND verified.attempt_kind = 'VERIFICATION'
        AND verified.outcome = 'SUCCEEDED'
        AND verified.attempt_revision > COALESCE((
          SELECT MAX(runtime.attempt_revision)
          FROM model_binding_application_attempts runtime
          WHERE runtime.operation_id = NEW.operation_id
            AND runtime.attempt_kind IN ('RUNTIME_APPLY','STARTUP_REHYDRATE')
        ), 0)
    ))
BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_APPLICATION_VERIFICATION_TERMINAL: verified operation cannot be reverified');
    END;
CREATE TRIGGER trg_model_binding_provider_claim_conflict
    BEFORE INSERT ON model_binding_provider_operations
    WHEN NOT (NEW.command_seq <> -1 OR EXISTS (
      SELECT 1
      FROM model_binding_provider_operations existing
      WHERE existing.operation_id = NEW.operation_id
         OR existing.request_key = NEW.request_key
         OR existing.initial_claim_token = NEW.initial_claim_token
    ))
  AND (EXISTS (
      SELECT 1
      FROM model_binding_provider_claims claim
      WHERE claim.role = NEW.role
         OR (claim.provider_origin = NEW.provider_origin
           AND claim.requested_canonical_name = NEW.requested_canonical_name)
    ))
BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_PROVIDER_CLAIM_HELD: provider effect authority is already claimed');
    END;
CREATE TRIGGER trg_model_binding_provider_desired_revision
    BEFORE INSERT ON model_binding_provider_operations
    WHEN NOT (NEW.command_seq <> -1 OR EXISTS (
      SELECT 1
      FROM model_binding_provider_operations existing
      WHERE existing.operation_id = NEW.operation_id
         OR existing.request_key = NEW.request_key
         OR existing.initial_claim_token = NEW.initial_claim_token
    ))
  AND (NEW.request_purpose = 'USER_APPLY_TARGET' AND NOT EXISTS (
      SELECT 1
      FROM model_desired_bindings desired
      WHERE desired.role = NEW.role
        AND desired.binding_revision = NEW.expected_binding_revision
    ))
BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_PROVIDER_DESIRED_MISMATCH: provider intent requires the current desired binding revision');
    END;
CREATE TRIGGER trg_model_binding_provider_noop_request_conflict
    BEFORE INSERT ON model_binding_provider_operations
    WHEN NOT (NEW.command_seq <> -1 OR EXISTS (
      SELECT 1
      FROM model_binding_provider_operations existing
      WHERE existing.operation_id = NEW.operation_id
         OR existing.request_key = NEW.request_key
         OR existing.initial_claim_token = NEW.initial_claim_token
    ))
  AND (EXISTS (
      SELECT 1 FROM model_binding_user_noop_receipts receipt
      WHERE receipt.request_key = NEW.request_key
    ))
BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_USER_NOOP_REQUEST_CONFLICT: request key already owns a no-op receipt');
    END;
CREATE TRIGGER trg_model_binding_provider_operations_user_actor
    BEFORE INSERT ON model_binding_provider_operations
    WHEN NOT (NEW.command_seq <> -1 OR EXISTS (
      SELECT 1
      FROM model_binding_provider_operations existing
      WHERE existing.operation_id = NEW.operation_id
         OR existing.request_key = NEW.request_key
         OR existing.initial_claim_token = NEW.initial_claim_token
    ))
  AND (substr(NEW.actor, 1, 5) <> 'user:' OR length(NEW.actor) <= 5
      OR instr(NEW.actor, ' ') > 0 OR instr(NEW.actor, char(9)) > 0
      OR instr(NEW.actor, char(10)) > 0 OR instr(NEW.actor, char(11)) > 0
      OR instr(NEW.actor, char(12)) > 0 OR instr(NEW.actor, char(13)) > 0
      OR instr(NEW.actor, char(160)) > 0 OR instr(NEW.actor, char(5760)) > 0
      OR instr(NEW.actor, char(8192)) > 0 OR instr(NEW.actor, char(8193)) > 0
      OR instr(NEW.actor, char(8194)) > 0 OR instr(NEW.actor, char(8195)) > 0
      OR instr(NEW.actor, char(8196)) > 0 OR instr(NEW.actor, char(8197)) > 0
      OR instr(NEW.actor, char(8198)) > 0 OR instr(NEW.actor, char(8199)) > 0
      OR instr(NEW.actor, char(8200)) > 0 OR instr(NEW.actor, char(8201)) > 0
      OR instr(NEW.actor, char(8202)) > 0 OR instr(NEW.actor, char(8232)) > 0
      OR instr(NEW.actor, char(8233)) > 0 OR instr(NEW.actor, char(8239)) > 0
      OR instr(NEW.actor, char(8287)) > 0 OR instr(NEW.actor, char(12288)) > 0
      OR instr(NEW.actor, char(65279)) > 0)
BEGIN
      SELECT RAISE(ABORT, 'model binding provider operation requires a user actor');
    END;
CREATE TRIGGER trg_model_binding_provider_unresolved_success
    BEFORE INSERT ON model_binding_provider_operations
    WHEN NOT (NEW.command_seq <> -1 OR EXISTS (
      SELECT 1
      FROM model_binding_provider_operations existing
      WHERE existing.operation_id = NEW.operation_id
         OR existing.request_key = NEW.request_key
         OR existing.initial_claim_token = NEW.initial_claim_token
    ))
  AND (NEW.request_purpose = 'USER_APPLY_TARGET' AND EXISTS (
      SELECT 1
      FROM model_binding_provider_operations prior
      JOIN model_binding_provider_attempts terminal
        ON terminal.operation_id = prior.operation_id
      LEFT JOIN model_binding_operations binding
        ON binding.request_key = prior.request_key
      WHERE prior.role = NEW.role
        AND prior.request_purpose = 'USER_APPLY_TARGET'
        AND prior.expected_binding_revision = NEW.expected_binding_revision
        AND terminal.outcome IN ('SUCCEEDED','RECONCILED_PRESENT')
        AND binding.operation_id IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM model_binding_user_noop_provider_supersedes superseded
          WHERE superseded.provider_operation_id = prior.operation_id
        )
    ))
BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_PROVIDER_UNRESOLVED_SUCCESS: resolve the earlier provider success before recording another intent');
    END;
CREATE TRIGGER trg_model_binding_provider_attempt_once
    BEFORE INSERT ON model_binding_provider_attempts
    WHEN NOT (NEW.seq <> -1 OR EXISTS (
      SELECT 1
      FROM model_binding_provider_attempts existing
      WHERE existing.seq = NEW.seq
         OR (
           existing.operation_id = NEW.operation_id
           AND existing.attempt_revision = NEW.attempt_revision
         )
    ))
  AND (EXISTS (
      SELECT 1 FROM model_binding_provider_attempts existing
      WHERE existing.operation_id = NEW.operation_id
    ))
BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_PROVIDER_TERMINAL: provider effect already has a terminal outcome');
    END;
CREATE TRIGGER trg_model_binding_provider_success_identity
    BEFORE INSERT ON model_binding_provider_attempts
    WHEN NOT (NEW.seq <> -1 OR EXISTS (
      SELECT 1
      FROM model_binding_provider_attempts existing
      WHERE existing.seq = NEW.seq
         OR (
           existing.operation_id = NEW.operation_id
           AND existing.attempt_revision = NEW.attempt_revision
         )
    ))
  AND (NEW.outcome IN ('SUCCEEDED','RECONCILED_PRESENT') AND NOT EXISTS (
      SELECT 1 FROM model_binding_provider_operations operation
      WHERE operation.operation_id = NEW.operation_id
        AND operation.requested_canonical_name = NEW.observed_canonical_name
    ))
BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_PROVIDER_IDENTITY_MISMATCH: pull result changed canonical target');
    END;
CREATE TRIGGER trg_model_binding_provider_terminal_claim
    BEFORE INSERT ON model_binding_provider_attempts
    WHEN NOT (NEW.seq <> -1 OR EXISTS (
      SELECT 1
      FROM model_binding_provider_attempts existing
      WHERE existing.seq = NEW.seq
         OR (
           existing.operation_id = NEW.operation_id
           AND existing.attempt_revision = NEW.attempt_revision
         )
    ))
  AND (NOT EXISTS (
      SELECT 1
      FROM model_binding_provider_claims claim
      WHERE claim.operation_id = NEW.operation_id
        AND claim.claim_token = NEW.claim_token
        AND claim.fencing_revision = NEW.fencing_revision
        AND claim.lease_expires_at_ms >= NEW.created_at_ms
    ))
BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_PROVIDER_CLAIM_STALE: terminal audit requires the live fenced claim');
    END;
CREATE TRIGGER trg_model_binding_provider_time_order
    BEFORE INSERT ON model_binding_provider_attempts
    WHEN NOT (NEW.seq <> -1 OR EXISTS (
      SELECT 1
      FROM model_binding_provider_attempts existing
      WHERE existing.seq = NEW.seq
         OR (
           existing.operation_id = NEW.operation_id
           AND existing.attempt_revision = NEW.attempt_revision
         )
    ))
  AND (NOT EXISTS (
      SELECT 1 FROM model_binding_provider_operations operation
      WHERE operation.operation_id = NEW.operation_id
        AND operation.created_at_ms <= NEW.created_at_ms
    ))
BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_PROVIDER_TIME_ROLLBACK: terminal outcome precedes intent');
    END;
CREATE TRIGGER trg_model_binding_user_noop_actor
    BEFORE INSERT ON model_binding_user_noop_receipts
    WHEN NOT (NEW.rowid <> -1 OR NEW.receipt_id IS NULL OR EXISTS (
      SELECT 1
      FROM model_binding_user_noop_receipts existing
      WHERE existing.receipt_id = NEW.receipt_id
         OR existing.request_key = NEW.request_key
    ))
  AND (substr(NEW.actor, 1, 5) <> 'user:' OR length(NEW.actor) <= 5
      OR instr(NEW.actor, ' ') > 0 OR instr(NEW.actor, char(9)) > 0
      OR instr(NEW.actor, char(10)) > 0 OR instr(NEW.actor, char(11)) > 0
      OR instr(NEW.actor, char(12)) > 0 OR instr(NEW.actor, char(13)) > 0
      OR instr(NEW.actor, char(160)) > 0 OR instr(NEW.actor, char(5760)) > 0
      OR instr(NEW.actor, char(8192)) > 0 OR instr(NEW.actor, char(8193)) > 0
      OR instr(NEW.actor, char(8194)) > 0 OR instr(NEW.actor, char(8195)) > 0
      OR instr(NEW.actor, char(8196)) > 0 OR instr(NEW.actor, char(8197)) > 0
      OR instr(NEW.actor, char(8198)) > 0 OR instr(NEW.actor, char(8199)) > 0
      OR instr(NEW.actor, char(8200)) > 0 OR instr(NEW.actor, char(8201)) > 0
      OR instr(NEW.actor, char(8202)) > 0 OR instr(NEW.actor, char(8232)) > 0
      OR instr(NEW.actor, char(8233)) > 0 OR instr(NEW.actor, char(8239)) > 0
      OR instr(NEW.actor, char(8287)) > 0 OR instr(NEW.actor, char(12288)) > 0
      OR instr(NEW.actor, char(65279)) > 0)
BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_USER_NOOP_ACTOR_INVALID: receipt requires a user actor');
    END;
CREATE TRIGGER trg_model_binding_user_noop_projection
    BEFORE INSERT ON model_binding_user_noop_receipts
    WHEN NOT (NEW.rowid <> -1 OR NEW.receipt_id IS NULL OR EXISTS (
      SELECT 1
      FROM model_binding_user_noop_receipts existing
      WHERE existing.receipt_id = NEW.receipt_id
         OR existing.request_key = NEW.request_key
    ))
  AND (NOT EXISTS (
      SELECT 1
      FROM model_desired_bindings desired
      WHERE desired.role = NEW.role
        AND desired.binding_revision = NEW.binding_revision
        AND desired.model_name = NEW.model_name
        AND desired.canonical_name = NEW.canonical_name
        AND desired.digest_sha256 = NEW.digest_sha256
        AND desired.source = NEW.desired_source
        AND desired.actor = NEW.desired_actor
        AND desired.observed_at_ms = NEW.desired_observed_at_ms
        AND desired.updated_at_ms = NEW.desired_updated_at_ms
        AND desired.last_event_id = NEW.desired_last_event_id
        AND desired.updated_at_ms <= NEW.created_at_ms
    ))
BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_USER_NOOP_PROJECTION_MISMATCH: receipt must match current desired binding');
    END;
CREATE TRIGGER trg_model_binding_user_noop_provider_frontier
    BEFORE INSERT ON model_binding_user_noop_receipts
    WHEN NOT (NEW.rowid <> -1 OR NEW.receipt_id IS NULL OR EXISTS (
      SELECT 1
      FROM model_binding_user_noop_receipts existing
      WHERE existing.receipt_id = NEW.receipt_id
         OR existing.request_key = NEW.request_key
    ))
  AND (NEW.provider_command_cutoff_seq <> COALESCE((
      SELECT MAX(provider.command_seq)
      FROM model_binding_provider_operations provider
      WHERE provider.role = NEW.role
        AND provider.request_purpose = 'USER_APPLY_TARGET'
        AND provider.expected_binding_revision = NEW.binding_revision
    ), 0))
BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_USER_NOOP_PROVIDER_FRONTIER_MISMATCH: receipt must pin the current provider command frontier');
    END;
CREATE TRIGGER trg_model_binding_user_noop_provider_pending
    BEFORE INSERT ON model_binding_user_noop_receipts
    WHEN NOT (NEW.rowid <> -1 OR NEW.receipt_id IS NULL OR EXISTS (
      SELECT 1
      FROM model_binding_user_noop_receipts existing
      WHERE existing.receipt_id = NEW.receipt_id
         OR existing.request_key = NEW.request_key
    ))
  AND (EXISTS (
      SELECT 1
      FROM model_binding_provider_operations provider
      LEFT JOIN model_binding_provider_attempts terminal
        ON terminal.operation_id = provider.operation_id
      WHERE provider.role = NEW.role
        AND provider.request_purpose = 'USER_APPLY_TARGET'
        AND provider.expected_binding_revision = NEW.binding_revision
        AND provider.command_seq <= NEW.provider_command_cutoff_seq
        AND terminal.operation_id IS NULL
    ))
BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_USER_NOOP_PROVIDER_PENDING: no-op receipt cannot overtake a live provider command');
    END;
CREATE TRIGGER trg_model_binding_user_noop_provider_time_order
    BEFORE INSERT ON model_binding_user_noop_receipts
    WHEN NOT (NEW.rowid <> -1 OR NEW.receipt_id IS NULL OR EXISTS (
      SELECT 1
      FROM model_binding_user_noop_receipts existing
      WHERE existing.receipt_id = NEW.receipt_id
         OR existing.request_key = NEW.request_key
    ))
  AND (EXISTS (
      SELECT 1
      FROM model_binding_provider_operations provider
      JOIN model_binding_provider_attempts terminal
        ON terminal.operation_id = provider.operation_id
      WHERE provider.role = NEW.role
        AND provider.request_purpose = 'USER_APPLY_TARGET'
        AND provider.expected_binding_revision = NEW.binding_revision
        AND provider.command_seq <= NEW.provider_command_cutoff_seq
        AND terminal.created_at_ms > NEW.created_at_ms
        AND NOT EXISTS (
          SELECT 1
          FROM model_binding_user_noop_provider_supersedes superseded
          WHERE superseded.provider_operation_id = provider.operation_id
        )
    ))
BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_USER_NOOP_TIME_ROLLBACK: no-op receipt precedes a provider terminal');
    END;
CREATE TRIGGER trg_model_binding_user_noop_request_key
    BEFORE INSERT ON model_binding_user_noop_receipts
    WHEN NOT (NEW.rowid <> -1 OR NEW.receipt_id IS NULL OR EXISTS (
      SELECT 1
      FROM model_binding_user_noop_receipts existing
      WHERE existing.receipt_id = NEW.receipt_id
         OR existing.request_key = NEW.request_key
    ))
  AND (EXISTS (
      SELECT 1 FROM model_binding_operations binding
      WHERE binding.request_key = NEW.request_key
    ) OR EXISTS (
      SELECT 1 FROM model_binding_provider_operations provider
      WHERE provider.request_key = NEW.request_key
        AND (
          NEW.source_provider_operation_id IS NULL
          OR provider.operation_id <> NEW.source_provider_operation_id
        )
    ))
BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_USER_NOOP_REQUEST_CONFLICT: request key already owns another command');
    END;
CREATE TRIGGER trg_model_binding_user_noop_source_provider_lineage
    BEFORE INSERT ON model_binding_user_noop_receipts
    WHEN NOT (NEW.rowid <> -1 OR NEW.receipt_id IS NULL OR EXISTS (
      SELECT 1
      FROM model_binding_user_noop_receipts existing
      WHERE existing.receipt_id = NEW.receipt_id
         OR existing.request_key = NEW.request_key
    ))
  AND (NEW.source_provider_operation_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM model_binding_provider_operations provider
      JOIN model_binding_provider_attempts terminal
        ON terminal.operation_id = provider.operation_id
      WHERE provider.operation_id = NEW.source_provider_operation_id
        AND provider.request_key = NEW.request_key
        AND provider.role = NEW.role
        AND provider.request_purpose = 'USER_APPLY_TARGET'
        AND provider.expected_binding_revision = NEW.binding_revision
        AND provider.command_seq = NEW.provider_command_cutoff_seq
        AND provider.actor = NEW.actor
        AND provider.created_at_ms <= NEW.created_at_ms
        AND terminal.created_at_ms <= NEW.created_at_ms
        AND terminal.outcome IN ('SUCCEEDED','RECONCILED_PRESENT')
        AND terminal.observed_canonical_name = NEW.canonical_name
        AND terminal.observed_digest_sha256 = NEW.digest_sha256
        AND NOT EXISTS (
          SELECT 1
          FROM model_binding_user_noop_provider_supersedes superseded
          WHERE superseded.provider_operation_id = provider.operation_id
        )
    ))
BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_USER_NOOP_SOURCE_LINEAGE_MISMATCH: source provider command must exactly match the no-op receipt');
    END;
CREATE TRIGGER trg_model_binding_user_noop_provider_cutoff
    BEFORE INSERT ON model_binding_user_noop_provider_supersedes
    WHEN NOT (NEW.rowid <> -1 OR EXISTS (
      SELECT 1
      FROM model_binding_user_noop_provider_supersedes existing
      WHERE (
          existing.receipt_id = NEW.receipt_id
          AND existing.provider_operation_id = NEW.provider_operation_id
        )
        OR existing.provider_operation_id = NEW.provider_operation_id
    ))
  AND ((
      SELECT provider.command_seq > receipt.provider_command_cutoff_seq
      FROM model_binding_provider_operations provider
      JOIN model_binding_user_noop_receipts receipt
        ON receipt.receipt_id = NEW.receipt_id
      WHERE provider.operation_id = NEW.provider_operation_id
    ) = 1)
BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_USER_NOOP_PROVIDER_CUTOFF_MISMATCH: provider command is newer than the receipt frontier');
    END;
CREATE TRIGGER trg_model_binding_user_noop_provider_lineage
    BEFORE INSERT ON model_binding_user_noop_provider_supersedes
    WHEN NOT (NEW.rowid <> -1 OR EXISTS (
      SELECT 1
      FROM model_binding_user_noop_provider_supersedes existing
      WHERE (
          existing.receipt_id = NEW.receipt_id
          AND existing.provider_operation_id = NEW.provider_operation_id
        )
        OR existing.provider_operation_id = NEW.provider_operation_id
    ))
  AND (NOT EXISTS (
      SELECT 1
      FROM model_binding_user_noop_receipts receipt
      JOIN model_binding_provider_operations provider
        ON provider.operation_id = NEW.provider_operation_id
      JOIN model_binding_provider_attempts terminal
        ON terminal.operation_id = provider.operation_id
      WHERE receipt.receipt_id = NEW.receipt_id
        AND provider.role = receipt.role
        AND provider.request_purpose = 'USER_APPLY_TARGET'
        AND provider.expected_binding_revision = receipt.binding_revision
        AND provider.command_seq <= receipt.provider_command_cutoff_seq
        AND provider.created_at_ms <= receipt.created_at_ms
        AND terminal.created_at_ms <= receipt.created_at_ms
    ))
BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_USER_NOOP_PROVIDER_LINEAGE_MISMATCH: superseded provider command must be terminal and share role and revision');
    END;
CREATE TRIGGER trg_model_failover_proofs_rowid_authority
    BEFORE INSERT ON model_failover_proofs
    WHEN NEW.rowid <> -1
    BEGIN
      SELECT RAISE(ABORT, 'MODEL_FAILOVER_PROOF_ROWID_AUTHORITY: proof rowid is database assigned');
    END;
CREATE TRIGGER trg_model_failover_proofs_identity_required
    BEFORE INSERT ON model_failover_proofs
    WHEN NEW.rowid = -1 AND NEW.proof_id IS NULL
    BEGIN
      SELECT RAISE(ABORT, 'MODEL_FAILOVER_PROOF_IDENTITY_REQUIRED: proof identity must be non-null');
    END;
CREATE TRIGGER trg_model_failover_proofs_append_only_insert_conflict
    BEFORE INSERT ON model_failover_proofs
    WHEN NEW.rowid = -1 AND NOT (NEW.proof_id IS NULL) AND EXISTS (
      SELECT 1
      FROM model_failover_proofs existing
      WHERE existing.proof_id = NEW.proof_id
         OR (
           existing.validation_run_id = NEW.validation_run_id
           AND existing.role = NEW.role
         )
    )
    BEGIN
      SELECT RAISE(ABORT, 'MODEL_FAILOVER_PROOF_IDENTITY_CONFLICT: proof audit identity is already committed');
    END;
CREATE TRIGGER trg_model_failover_proofs_rowid_positive
    AFTER INSERT ON model_failover_proofs
    WHEN NEW.rowid <= 0
    BEGIN
      SELECT RAISE(ABORT, 'MODEL_FAILOVER_PROOF_ROWID_AUTHORITY: proof rowid is database assigned');
    END;
CREATE TRIGGER trg_model_failover_events_sequence_authority
    BEFORE INSERT ON model_failover_events
    WHEN NEW.seq <> -1
    BEGIN
      SELECT RAISE(ABORT, 'MODEL_FAILOVER_EVENT_SEQUENCE_AUTHORITY: event sequence is database assigned');
    END;
CREATE TRIGGER trg_model_failover_events_append_only_insert_conflict
    BEFORE INSERT ON model_failover_events
    WHEN NEW.seq = -1 AND EXISTS (
      SELECT 1
      FROM model_failover_events existing
      WHERE existing.event_id = NEW.event_id
         OR (
           NEW.operation_id IS NOT NULL
           AND existing.operation_id = NEW.operation_id
           AND existing.event_type = NEW.event_type
         )
    )
    BEGIN
      SELECT RAISE(ABORT, 'MODEL_FAILOVER_EVENT_IDENTITY_CONFLICT: event audit identity is already committed');
    END;
CREATE TRIGGER trg_model_failover_events_sequence_positive
    AFTER INSERT ON model_failover_events
    WHEN NEW.seq <= 0
    BEGIN
      SELECT RAISE(ABORT, 'MODEL_FAILOVER_EVENT_SEQUENCE_AUTHORITY: event sequence is database assigned');
    END;
CREATE TRIGGER trg_model_binding_operations_rowid_authority
    BEFORE INSERT ON model_binding_operations
    WHEN NEW.rowid <> -1
    BEGIN
      SELECT RAISE(ABORT, 'MODEL_BINDING_OPERATION_ROWID_AUTHORITY: binding operation rowid is database assigned');
    END;
CREATE TRIGGER trg_model_binding_operations_identity_required
    BEFORE INSERT ON model_binding_operations
    WHEN NEW.rowid = -1 AND NEW.operation_id IS NULL
    BEGIN
      SELECT RAISE(ABORT, 'MODEL_BINDING_OPERATION_IDENTITY_REQUIRED: binding operation identity must be non-null');
    END;
CREATE TRIGGER trg_model_binding_operations_append_only_insert_conflict
    BEFORE INSERT ON model_binding_operations
    WHEN NEW.rowid = -1 AND NOT (NEW.operation_id IS NULL) AND EXISTS (
      SELECT 1
      FROM model_binding_operations existing
      WHERE existing.operation_id = NEW.operation_id
         OR existing.request_key = NEW.request_key
         OR existing.desired_event_id = NEW.desired_event_id
         OR (
           existing.role = NEW.role
           AND existing.committed_binding_revision = NEW.committed_binding_revision
         )
         OR (
           NEW.rollback_of_operation_id IS NOT NULL
           AND existing.rollback_of_operation_id = NEW.rollback_of_operation_id
         )
    )
    BEGIN
      SELECT RAISE(ABORT, 'MODEL_BINDING_OPERATION_IDENTITY_CONFLICT: binding audit identity is already committed');
    END;
CREATE TRIGGER trg_model_binding_operations_rowid_positive
    AFTER INSERT ON model_binding_operations
    WHEN NEW.rowid <= 0
    BEGIN
      SELECT RAISE(ABORT, 'MODEL_BINDING_OPERATION_ROWID_AUTHORITY: binding operation rowid is database assigned');
    END;
CREATE TRIGGER trg_model_binding_application_sequence_authority
    BEFORE INSERT ON model_binding_application_attempts
    WHEN NEW.seq <> -1
    BEGIN
      SELECT RAISE(ABORT, 'MODEL_BINDING_APPLICATION_SEQUENCE_AUTHORITY: application sequence is database assigned');
    END;
CREATE TRIGGER trg_model_binding_application_append_only_insert_conflict
    BEFORE INSERT ON model_binding_application_attempts
    WHEN NEW.seq = -1 AND EXISTS (
      SELECT 1
      FROM model_binding_application_attempts existing
      WHERE existing.seq = NEW.seq
         OR (
           existing.operation_id = NEW.operation_id
           AND existing.attempt_revision = NEW.attempt_revision
         )
    )
    BEGIN
      SELECT RAISE(ABORT, 'MODEL_BINDING_APPLICATION_IDENTITY_CONFLICT: application audit identity is already committed');
    END;
CREATE TRIGGER trg_model_binding_application_sequence_positive
    AFTER INSERT ON model_binding_application_attempts
    WHEN NEW.seq <= 0
    BEGIN
      SELECT RAISE(ABORT, 'MODEL_BINDING_APPLICATION_SEQUENCE_AUTHORITY: application sequence is database assigned');
    END;
CREATE TRIGGER trg_model_binding_provider_command_sequence_authority
    BEFORE INSERT ON model_binding_provider_operations
    WHEN NEW.command_seq <> -1
    BEGIN
      SELECT RAISE(ABORT, 'MODEL_BINDING_PROVIDER_COMMAND_SEQUENCE_AUTHORITY: command sequence is database assigned');
    END;
CREATE TRIGGER trg_model_binding_provider_operations_append_only_insert_conflict
    BEFORE INSERT ON model_binding_provider_operations
    WHEN NEW.command_seq = -1 AND EXISTS (
      SELECT 1
      FROM model_binding_provider_operations existing
      WHERE existing.operation_id = NEW.operation_id
         OR existing.request_key = NEW.request_key
         OR existing.initial_claim_token = NEW.initial_claim_token
    )
    BEGIN
      SELECT RAISE(ABORT, 'MODEL_BINDING_PROVIDER_OPERATION_IDENTITY_CONFLICT: provider audit identity is already committed');
    END;
CREATE TRIGGER trg_model_binding_provider_command_sequence_positive
    AFTER INSERT ON model_binding_provider_operations
    WHEN NEW.command_seq <= 0
    BEGIN
      SELECT RAISE(ABORT, 'MODEL_BINDING_PROVIDER_COMMAND_SEQUENCE_AUTHORITY: command sequence is database assigned');
    END;
CREATE TRIGGER trg_model_binding_provider_attempts_sequence_authority
    BEFORE INSERT ON model_binding_provider_attempts
    WHEN NEW.seq <> -1
    BEGIN
      SELECT RAISE(ABORT, 'MODEL_BINDING_PROVIDER_ATTEMPT_SEQUENCE_AUTHORITY: provider attempt sequence is database assigned');
    END;
CREATE TRIGGER trg_model_binding_provider_attempts_append_only_insert_conflict
    BEFORE INSERT ON model_binding_provider_attempts
    WHEN NEW.seq = -1 AND EXISTS (
      SELECT 1
      FROM model_binding_provider_attempts existing
      WHERE existing.seq = NEW.seq
         OR (
           existing.operation_id = NEW.operation_id
           AND existing.attempt_revision = NEW.attempt_revision
         )
    )
    BEGIN
      SELECT RAISE(ABORT, 'MODEL_BINDING_PROVIDER_ATTEMPT_IDENTITY_CONFLICT: provider attempt identity is already committed');
    END;
CREATE TRIGGER trg_model_binding_provider_attempts_sequence_positive
    AFTER INSERT ON model_binding_provider_attempts
    WHEN NEW.seq <= 0
    BEGIN
      SELECT RAISE(ABORT, 'MODEL_BINDING_PROVIDER_ATTEMPT_SEQUENCE_AUTHORITY: provider attempt sequence is database assigned');
    END;
CREATE TRIGGER trg_model_binding_user_noop_rowid_authority
    BEFORE INSERT ON model_binding_user_noop_receipts
    WHEN NEW.rowid <> -1
    BEGIN
      SELECT RAISE(ABORT, 'MODEL_BINDING_USER_NOOP_ROWID_AUTHORITY: receipt rowid is database assigned');
    END;
CREATE TRIGGER trg_model_binding_user_noop_identity_required
    BEFORE INSERT ON model_binding_user_noop_receipts
    WHEN NEW.rowid = -1 AND NEW.receipt_id IS NULL
    BEGIN
      SELECT RAISE(ABORT, 'MODEL_BINDING_USER_NOOP_IDENTITY_REQUIRED: receipt identity must be non-null');
    END;
CREATE TRIGGER trg_model_binding_user_noop_append_only_insert_conflict
    BEFORE INSERT ON model_binding_user_noop_receipts
    WHEN NEW.rowid = -1 AND NOT (NEW.receipt_id IS NULL) AND EXISTS (
      SELECT 1
      FROM model_binding_user_noop_receipts existing
      WHERE existing.receipt_id = NEW.receipt_id
         OR existing.request_key = NEW.request_key
    )
    BEGIN
      SELECT RAISE(ABORT, 'MODEL_BINDING_USER_NOOP_APPEND_ONLY_CONFLICT: receipt identity is already committed');
    END;
CREATE TRIGGER trg_model_binding_user_noop_rowid_positive
    AFTER INSERT ON model_binding_user_noop_receipts
    WHEN NEW.rowid <= 0
    BEGIN
      SELECT RAISE(ABORT, 'MODEL_BINDING_USER_NOOP_ROWID_AUTHORITY: receipt rowid is database assigned');
    END;
CREATE TRIGGER trg_model_binding_user_noop_provider_supersedes_rowid_authority
    BEFORE INSERT ON model_binding_user_noop_provider_supersedes
    WHEN NEW.rowid <> -1
    BEGIN
      SELECT RAISE(ABORT, 'MODEL_BINDING_USER_NOOP_PROVIDER_SUPERSEDES_ROWID_AUTHORITY: provider lineage rowid is database assigned');
    END;
CREATE TRIGGER trg_model_binding_user_noop_provider_supersedes_insert_conflict
    BEFORE INSERT ON model_binding_user_noop_provider_supersedes
    WHEN NEW.rowid = -1 AND EXISTS (
      SELECT 1
      FROM model_binding_user_noop_provider_supersedes existing
      WHERE (
          existing.receipt_id = NEW.receipt_id
          AND existing.provider_operation_id = NEW.provider_operation_id
        )
        OR existing.provider_operation_id = NEW.provider_operation_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'MODEL_BINDING_USER_NOOP_PROVIDER_SUPERSEDES_CONFLICT: provider lineage is already committed');
    END;
CREATE TRIGGER trg_model_binding_user_noop_provider_supersedes_rowid_positive
    AFTER INSERT ON model_binding_user_noop_provider_supersedes
    WHEN NEW.rowid <= 0
    BEGIN
      SELECT RAISE(ABORT, 'MODEL_BINDING_USER_NOOP_PROVIDER_SUPERSEDES_ROWID_AUTHORITY: provider lineage rowid is database assigned');
    END;
CREATE TRIGGER trg_model_binding_runtime_finalize_cutoff_sealed_insert
    BEFORE INSERT ON model_binding_runtime_finalize_cutoffs
    BEGIN
      SELECT RAISE(ABORT, 'model_binding_runtime_finalize_cutoffs is migration-sealed');
    END;
CREATE TRIGGER trg_model_binding_runtime_finalize_cutoff_sealed_update
    BEFORE UPDATE ON model_binding_runtime_finalize_cutoffs
    BEGIN
      SELECT RAISE(ABORT, 'model_binding_runtime_finalize_cutoffs is migration-sealed');
    END;
CREATE TRIGGER trg_model_binding_runtime_finalize_cutoff_sealed_delete
    BEFORE DELETE ON model_binding_runtime_finalize_cutoffs
    BEGIN
      SELECT RAISE(ABORT, 'model_binding_runtime_finalize_cutoffs is migration-sealed');
    END;
CREATE TRIGGER trg_model_binding_runtime_finalize_sequence_authority
    BEFORE INSERT ON model_binding_runtime_finalize_receipts
    WHEN NEW.seq <> -1
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_RUNTIME_FINALIZE_SEQUENCE_AUTHORITY: finalize sequence is database assigned');
    END;
CREATE TRIGGER trg_model_binding_runtime_finalize_sequence_positive
    AFTER INSERT ON model_binding_runtime_finalize_receipts
    WHEN NEW.seq <= 0
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_RUNTIME_FINALIZE_SEQUENCE_AUTHORITY: finalize sequence must be positive');
    END;
CREATE TRIGGER trg_model_binding_runtime_finalize_identity_conflict
    BEFORE INSERT ON model_binding_runtime_finalize_receipts
    WHEN EXISTS (
      SELECT 1
      FROM model_binding_runtime_finalize_receipts existing
      WHERE existing.seq = NEW.seq
         OR (
           existing.operation_id = NEW.operation_id
           AND existing.runtime_attempt_revision = NEW.runtime_attempt_revision
         )
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_RUNTIME_FINALIZE_IDENTITY_CONFLICT: finalize receipt is already committed');
    END;
CREATE TRIGGER trg_model_binding_runtime_finalize_attempt_shape
    BEFORE INSERT ON model_binding_runtime_finalize_receipts
    WHEN NOT EXISTS (
      SELECT 1
      FROM model_binding_application_attempts attempt
      WHERE attempt.operation_id = NEW.operation_id
        AND attempt.attempt_revision = NEW.runtime_attempt_revision
        AND attempt.attempt_kind IN ('RUNTIME_APPLY','STARTUP_REHYDRATE')
        AND attempt.outcome = 'SUCCEEDED'
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_RUNTIME_FINALIZE_ATTEMPT_INVALID: receipt requires a successful runtime attempt');
    END;
CREATE TRIGGER trg_model_binding_runtime_finalize_current_desired
    BEFORE INSERT ON model_binding_runtime_finalize_receipts
    WHEN NOT EXISTS (
      SELECT 1
      FROM model_binding_operations operation
      JOIN model_desired_bindings desired
        ON desired.role = operation.role
       AND desired.binding_revision = operation.committed_binding_revision
       AND desired.model_name = operation.target_model_name
       AND desired.canonical_name = operation.target_canonical_name
       AND desired.digest_sha256 = operation.target_digest_sha256
       AND desired.source = operation.operation_kind
       AND desired.actor = operation.actor
       AND desired.last_event_id = operation.desired_event_id
      WHERE operation.operation_id = NEW.operation_id
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_RUNTIME_FINALIZE_DESIRED_MISMATCH: operation is not current desired authority');
    END;
CREATE TRIGGER trg_model_binding_runtime_finalize_direct_latest
    BEFORE INSERT ON model_binding_runtime_finalize_receipts
    WHEN NEW.finalization_kind = 'DIRECT_CONFIRMED'
      AND NEW.runtime_attempt_revision <> (
        SELECT MAX(attempt.attempt_revision)
        FROM model_binding_application_attempts attempt
        WHERE attempt.operation_id = NEW.operation_id
          AND attempt.attempt_kind IN ('RUNTIME_APPLY','STARTUP_REHYDRATE')
      )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_RUNTIME_FINALIZE_NOT_LATEST: direct receipt must confirm the latest runtime generation');
    END;
CREATE TRIGGER trg_model_binding_runtime_finalize_direct_after_cutoff
    BEFORE INSERT ON model_binding_runtime_finalize_receipts
    WHEN NEW.finalization_kind = 'DIRECT_CONFIRMED'
      AND EXISTS (
        SELECT 1
        FROM model_binding_runtime_finalize_cutoffs cutoff
        WHERE cutoff.operation_id = NEW.operation_id
          AND NEW.runtime_attempt_revision
            <= cutoff.max_preexisting_runtime_attempt_revision
      )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_RUNTIME_FINALIZE_REHYDRATE_REQUIRED: pre-054 runtime success requires a new startup generation');
    END;
CREATE TRIGGER trg_model_binding_runtime_finalize_recovery_lineage
    BEFORE INSERT ON model_binding_runtime_finalize_receipts
    WHEN NEW.finalization_kind = 'RECOVERED_BY' AND NOT EXISTS (
      SELECT 1
      FROM model_binding_application_attempts recovery
      JOIN model_binding_runtime_finalize_receipts confirmation
        ON confirmation.operation_id = recovery.operation_id
       AND confirmation.runtime_attempt_revision = recovery.attempt_revision
       AND confirmation.finalization_kind = 'DIRECT_CONFIRMED'
      WHERE recovery.operation_id = NEW.operation_id
        AND recovery.attempt_revision = NEW.recovered_by_attempt_revision
        AND recovery.attempt_kind = 'STARTUP_REHYDRATE'
        AND recovery.outcome = 'SUCCEEDED'
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_RUNTIME_FINALIZE_RECOVERY_INVALID: recovery requires a later confirmed startup generation');
    END;
CREATE TRIGGER trg_model_binding_runtime_finalize_time_order
    BEFORE INSERT ON model_binding_runtime_finalize_receipts
    WHEN NOT EXISTS (
      SELECT 1
      FROM model_binding_application_attempts attempt
      WHERE attempt.operation_id = NEW.operation_id
        AND attempt.attempt_revision = NEW.runtime_attempt_revision
        AND attempt.created_at_ms <= NEW.created_at_ms
    ) OR (
      NEW.recovered_by_attempt_revision IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM model_binding_application_attempts recovery
        WHERE recovery.operation_id = NEW.operation_id
          AND recovery.attempt_revision = NEW.recovered_by_attempt_revision
          AND recovery.created_at_ms <= NEW.created_at_ms
      )
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_RUNTIME_FINALIZE_TIME_ROLLBACK: receipt time precedes its authority');
    END;
CREATE TRIGGER trg_model_binding_runtime_finalize_append_only_update
    BEFORE UPDATE ON model_binding_runtime_finalize_receipts
    BEGIN
      SELECT RAISE(ABORT, 'model_binding_runtime_finalize_receipts is append-only');
    END;
CREATE TRIGGER trg_model_binding_runtime_finalize_append_only_delete
    BEFORE DELETE ON model_binding_runtime_finalize_receipts
    BEGIN
      SELECT RAISE(ABORT, 'model_binding_runtime_finalize_receipts is append-only');
    END;
CREATE TRIGGER trg_model_binding_application_finalize_prerequisite
    BEFORE INSERT ON model_binding_application_attempts
    WHEN NEW.attempt_kind IN ('VERIFICATION','NOTIFICATION')
      AND NOT EXISTS (
        SELECT 1
        FROM model_binding_application_attempts runtime
        JOIN model_binding_runtime_finalize_receipts receipt
          ON receipt.operation_id = runtime.operation_id
         AND receipt.runtime_attempt_revision = runtime.attempt_revision
         AND receipt.finalization_kind = 'DIRECT_CONFIRMED'
        WHERE runtime.operation_id = NEW.operation_id
          AND runtime.attempt_kind IN ('RUNTIME_APPLY','STARTUP_REHYDRATE')
          AND runtime.outcome = 'SUCCEEDED'
          AND runtime.attempt_revision = (
            SELECT MAX(latest.attempt_revision)
            FROM model_binding_application_attempts latest
            WHERE latest.operation_id = NEW.operation_id
              AND latest.attempt_kind IN ('RUNTIME_APPLY','STARTUP_REHYDRATE')
          )
      )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_RUNTIME_FINALIZE_REQUIRED: terminal effect requires a confirmed runtime generation');
    END;
CREATE TRIGGER trg_model_automation_event_identity_conflict
    BEFORE INSERT ON model_automation_policy_events
    WHEN EXISTS (
      SELECT 1
      FROM model_automation_policy_events existing
      WHERE existing.seq = NEW.seq
         OR existing.event_id = NEW.event_id
         OR existing.request_id = NEW.request_id
         OR existing.committed_revision = NEW.committed_revision
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_AUTOMATION_POLICY_EVENT_IDENTITY_CONFLICT: append-only identity exists');
    END;
CREATE TRIGGER trg_model_automation_event_revision
    BEFORE INSERT ON model_automation_policy_events
    WHEN NEW.previous_revision <> COALESCE((
      SELECT MAX(existing.committed_revision)
      FROM model_automation_policy_events existing
    ), 0)
      OR NEW.committed_revision <> COALESCE((
        SELECT MAX(existing.committed_revision)
        FROM model_automation_policy_events existing
      ), 0) + 1
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_AUTOMATION_POLICY_EVENT_REVISION_MISMATCH: event must append exactly');
    END;
CREATE TRIGGER trg_model_automation_event_lineage
    BEFORE INSERT ON model_automation_policy_events
    WHEN NEW.previous_revision > 0 AND NOT EXISTS (
      SELECT 1
      FROM model_automation_policy_events previous
      WHERE previous.committed_revision = NEW.previous_revision
        AND previous.after_auto_failover_enabled = NEW.before_auto_failover_enabled
        AND previous.after_auto_cleanup_enabled = NEW.before_auto_cleanup_enabled
        AND previous.after_auto_cleanup_days = NEW.before_auto_cleanup_days
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_AUTOMATION_POLICY_EVENT_LINEAGE_MISMATCH: before state is not current');
    END;
CREATE TRIGGER trg_model_automation_event_projection
    BEFORE INSERT ON model_automation_policy_events
    WHEN NOT EXISTS (
      SELECT 1
      FROM model_automation_policy policy
      WHERE policy.id = 1
        AND policy.schema_version = NEW.schema_version
        AND policy.revision = NEW.committed_revision
        AND policy.auto_failover_enabled = NEW.after_auto_failover_enabled
        AND policy.auto_cleanup_enabled = NEW.after_auto_cleanup_enabled
        AND policy.auto_cleanup_days = NEW.after_auto_cleanup_days
        AND policy.last_event_id = NEW.event_id
        AND policy.updated_at_ms = NEW.created_at_ms
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_AUTOMATION_POLICY_EVENT_PROJECTION_MISMATCH: event lacks exact projection');
    END;
CREATE TRIGGER trg_model_automation_event_append_only_update
    BEFORE UPDATE ON model_automation_policy_events
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_AUTOMATION_POLICY_EVENT_APPEND_ONLY: events cannot be updated');
    END;
CREATE TRIGGER trg_model_automation_event_append_only_delete
    BEFORE DELETE ON model_automation_policy_events
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_AUTOMATION_POLICY_EVENT_APPEND_ONLY: events cannot be deleted');
    END;
CREATE TRIGGER trg_model_automation_projection_replace
    BEFORE INSERT ON model_automation_policy
    WHEN EXISTS (SELECT 1 FROM model_automation_policy WHERE id = 1)
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_AUTOMATION_POLICY_PROJECTION_REPLACE_FORBIDDEN: singleton already exists');
    END;
CREATE TRIGGER trg_model_automation_projection_revision
    BEFORE UPDATE ON model_automation_policy
    WHEN NEW.id <> OLD.id
      OR NEW.schema_version <> OLD.schema_version
      OR NEW.revision <> OLD.revision + 1
      OR NEW.last_event_id = OLD.last_event_id
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_AUTOMATION_POLICY_PROJECTION_REVISION_MISMATCH: projection must advance exactly');
    END;
CREATE TRIGGER trg_model_automation_projection_new_event
    BEFORE UPDATE ON model_automation_policy
    WHEN EXISTS (
      SELECT 1
      FROM model_automation_policy_events event
      WHERE event.event_id = NEW.last_event_id
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_AUTOMATION_POLICY_EVENT_IDENTITY_CONFLICT: projection must name a new event');
    END;
CREATE TRIGGER trg_model_automation_projection_current_event
    BEFORE UPDATE ON model_automation_policy
    WHEN NOT EXISTS (
      SELECT 1
      FROM model_automation_policy_events event
      WHERE event.event_id = OLD.last_event_id
        AND event.committed_revision = OLD.revision
        AND event.after_auto_failover_enabled = OLD.auto_failover_enabled
        AND event.after_auto_cleanup_enabled = OLD.auto_cleanup_enabled
        AND event.after_auto_cleanup_days = OLD.auto_cleanup_days
        AND event.created_at_ms = OLD.updated_at_ms
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_AUTOMATION_POLICY_PROJECTION_CURRENT_EVENT_MISMATCH: current projection is invalid');
    END;
CREATE TRIGGER trg_model_automation_projection_append_only_delete
    BEFORE DELETE ON model_automation_policy
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_AUTOMATION_POLICY_PROJECTION_DELETE_FORBIDDEN: singleton cannot be deleted');
    END;
CREATE TRIGGER trg_user_settings_model_automation_insert_guard
    BEFORE INSERT ON user_settings
    WHEN CASE
      WHEN json_valid(NEW.data) AND json_type(NEW.data, '$') = 'object' THEN
        EXISTS (
          SELECT 1
          FROM json_each(NEW.data) top_level
          JOIN json_each(
            CASE WHEN top_level.type = 'object' THEN top_level.value ELSE '{}' END
          ) model_member
          WHERE top_level.key = 'models'
            AND top_level.type = 'object'
            AND model_member.key IN (
              'autoFailoverEnabled',
              'autoCleanupEnabled',
              'autoCleanupDays'
            )
        )
      ELSE 0
    END
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_AUTOMATION_POLICY_LEGACY_KEY_FORBIDDEN: use versioned policy authority');
    END;
CREATE TRIGGER trg_user_settings_model_automation_update_guard
    BEFORE UPDATE OF data ON user_settings
    WHEN CASE
      WHEN json_valid(NEW.data) AND json_type(NEW.data, '$') = 'object' THEN
        EXISTS (
          SELECT 1
          FROM json_each(NEW.data) top_level
          JOIN json_each(
            CASE WHEN top_level.type = 'object' THEN top_level.value ELSE '{}' END
          ) model_member
          WHERE top_level.key = 'models'
            AND top_level.type = 'object'
            AND model_member.key IN (
              'autoFailoverEnabled',
              'autoCleanupEnabled',
              'autoCleanupDays'
            )
        )
      ELSE 0
    END
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_AUTOMATION_POLICY_LEGACY_KEY_FORBIDDEN: use versioned policy authority');
    END;
CREATE TRIGGER trg_model_failover_proof_artifacts_historical_attach
    BEFORE INSERT ON model_failover_proof_artifacts
    WHEN EXISTS (
      SELECT 1 FROM model_failover_proofs proof
      WHERE proof.proof_id = NEW.proof_id
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_FAILOVER_PROOF_HISTORICAL_ATTACH_FORBIDDEN: proof already exists');
    END;
CREATE TRIGGER trg_model_failover_proof_artifacts_identity_conflict
    BEFORE INSERT ON model_failover_proof_artifacts
    WHEN EXISTS (
      SELECT 1 FROM model_failover_proof_artifacts existing
      WHERE existing.proof_id = NEW.proof_id
         OR existing.parent_run_id = NEW.parent_run_id
         OR (
           existing.validation_run_id = NEW.validation_run_id
           AND existing.role = NEW.role
         )
         OR existing.measurement_artifact_sha256 = NEW.measurement_artifact_sha256
         OR existing.acceptance_artifact_sha256 = NEW.acceptance_artifact_sha256
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_FAILOVER_PROOF_ARTIFACT_IDENTITY_CONFLICT: evidence is committed');
    END;
CREATE TRIGGER trg_model_failover_proof_artifacts_append_only_update
    BEFORE UPDATE ON model_failover_proof_artifacts
    BEGIN
      SELECT RAISE(ABORT, 'model_failover_proof_artifacts is append-only');
    END;
CREATE TRIGGER trg_model_failover_proof_artifacts_append_only_delete
    BEFORE DELETE ON model_failover_proof_artifacts
    BEGIN
      SELECT RAISE(ABORT, 'model_failover_proof_artifacts is append-only');
    END;
CREATE TRIGGER trg_model_failover_proofs_artifact_companion
    AFTER INSERT ON model_failover_proofs
    WHEN NEW.rowid > 0 AND NOT EXISTS (
      SELECT 1
      FROM model_failover_proof_artifacts artifact
      WHERE artifact.proof_id = NEW.proof_id
        AND artifact.validation_run_id = NEW.validation_run_id
        AND artifact.role = NEW.role
        AND artifact.suite = NEW.suite
        AND artifact.role_contract_sha256 = NEW.role_contract_sha256
        AND artifact.model_name = NEW.model_name
        AND artifact.model_canonical_name = NEW.model_canonical_name
        AND artifact.model_digest_sha256 = NEW.model_digest_sha256
        AND artifact.validation_version = NEW.validation_version
        AND artifact.policy_version = NEW.policy_version
        AND artifact.score = NEW.score
        AND artifact.required_score = NEW.required_score
        AND artifact.passed_count = NEW.passed_count
        AND artifact.required_passed_count = NEW.required_passed_count
        AND artifact.total_count = NEW.total_count
        AND artifact.duration_ms = NEW.duration_ms
        AND artifact.result = NEW.result
        AND artifact.inventory_before_name = NEW.inventory_before_name
        AND artifact.inventory_before_digest = NEW.inventory_before_digest
        AND artifact.inventory_after_name = NEW.inventory_after_name
        AND artifact.inventory_after_digest = NEW.inventory_after_digest
        AND artifact.measurement_started_at_ms = NEW.started_at_ms
        AND artifact.measurement_completed_at_ms = NEW.completed_at_ms
        AND artifact.expires_at_ms = NEW.expires_at_ms
        AND artifact.issued_at_ms = NEW.created_at_ms
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_FAILOVER_PROOF_ARTIFACT_MISMATCH: proof lacks exact evidence companion');
    END;
CREATE TRIGGER trg_model_automation_policy_events_no_update
    BEFORE UPDATE ON model_automation_policy_events
    BEGIN
      SELECT RAISE(ABORT, 'model automation policy events are append-only');
    END;
CREATE TRIGGER trg_model_automation_policy_events_no_delete
    BEFORE DELETE ON model_automation_policy_events
    BEGIN
      SELECT RAISE(ABORT, 'model automation policy events are append-only');
    END;
CREATE TRIGGER trg_model_automation_policy_events_sequence
    BEFORE INSERT ON model_automation_policy_events
    BEGIN
      SELECT RAISE(ABORT, 'model automation policy event revision must advance by exactly one')
      WHERE NEW.revision <> (
        SELECT COALESCE(MAX(revision), 0) + 1 FROM model_automation_policy_events
      );
      SELECT RAISE(ABORT, 'model automation policy event sequence must advance by exactly one')
      WHERE NEW.seq <> (
        SELECT COALESCE(MAX(seq), 0) + 1 FROM model_automation_policy_events
      );
    END;
CREATE TRIGGER trg_model_automation_policy_projection_event
    BEFORE INSERT ON model_automation_policy
    BEGIN
      SELECT RAISE(ABORT, 'model automation policy projection must match its event')
      WHERE NOT EXISTS (
        SELECT 1 FROM model_automation_policy_events event
        WHERE event.event_id = NEW.last_event_id
          AND event.revision = NEW.revision
          AND event.auto_failover_enabled = NEW.auto_failover_enabled
          AND event.auto_cleanup_enabled = NEW.auto_cleanup_enabled
          AND event.auto_cleanup_days = NEW.auto_cleanup_days
      );
    END;
CREATE TRIGGER trg_model_automation_policy_projection_event_update
    BEFORE UPDATE ON model_automation_policy
    BEGIN
      SELECT RAISE(ABORT, 'model automation policy projection must match its event')
      WHERE NOT EXISTS (
        SELECT 1 FROM model_automation_policy_events event
        WHERE event.event_id = NEW.last_event_id
          AND event.revision = NEW.revision
          AND event.auto_failover_enabled = NEW.auto_failover_enabled
          AND event.auto_cleanup_enabled = NEW.auto_cleanup_enabled
          AND event.auto_cleanup_days = NEW.auto_cleanup_days
      );
      SELECT RAISE(ABORT, 'model automation policy revision must advance')
      WHERE NEW.revision <= OLD.revision;
    END;
CREATE TRIGGER trg_model_failover_proofs_require_artifacts
    BEFORE INSERT ON model_failover_proofs
    BEGIN
      SELECT RAISE(ABORT, 'proof requires a durable measurement artifact')
      WHERE NEW.measurement_artifact_sha256 IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM model_failover_proof_artifacts artifact
          WHERE artifact.artifact_sha256 = NEW.measurement_artifact_sha256
            AND artifact.kind = 'MEASUREMENT'
        );
      SELECT RAISE(ABORT, 'proof requires a durable parent acceptance artifact')
      WHERE NEW.acceptance_artifact_sha256 IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM model_failover_proof_artifacts artifact
          WHERE artifact.artifact_sha256 = NEW.acceptance_artifact_sha256
            AND artifact.kind = 'PARENT_ACCEPTANCE'
        );
      SELECT RAISE(ABORT, 'proof requires the source revision of both artifacts')
      WHERE NEW.source_revision IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM model_failover_proof_artifacts artifact
          WHERE artifact.artifact_sha256 = NEW.measurement_artifact_sha256
            AND artifact.source_revision = NEW.source_revision
        )
        OR NOT EXISTS (
          SELECT 1 FROM model_failover_proof_artifacts artifact
          WHERE artifact.artifact_sha256 = NEW.acceptance_artifact_sha256
            AND artifact.source_revision = NEW.source_revision
        );
    END;
CREATE TRIGGER trg_model_failover_events_fallback_proof
    BEFORE INSERT ON model_failover_events
    WHEN NEW.event_type IN ('ACTIVATED','REAPPLIED') AND NOT EXISTS (
      SELECT 1
      FROM model_failover_proofs proof
      JOIN model_desired_bindings desired
        ON desired.role = NEW.role
       AND desired.binding_revision = NEW.binding_revision
      WHERE proof.proof_id = NEW.proof_id
        AND proof.role = NEW.role
        AND proof.model_canonical_name = NEW.fallback_canonical_name
        AND proof.model_digest_sha256 = NEW.fallback_digest_sha256
        AND proof.policy_version = NEW.policy_version
        AND proof.completed_at_ms <= NEW.created_at_ms
        AND proof.expires_at_ms > NEW.created_at_ms
        AND NEW.desired_model_name = desired.model_name
        AND NEW.desired_digest_sha256 = desired.digest_sha256
        AND proof.result = 'PASS'
    )
    BEGIN
      SELECT RAISE(ABORT, 'verified fallback event requires matching fresh proof');
    END;
CREATE TRIGGER trg_model_failover_events_restore_proof
    BEFORE INSERT ON model_failover_events
    WHEN NEW.event_type = 'RESTORED' AND NOT EXISTS (
      SELECT 1
      FROM model_failover_proofs proof
      JOIN model_desired_bindings desired
        ON desired.role = NEW.role
       AND desired.binding_revision = NEW.binding_revision
      WHERE proof.proof_id = NEW.proof_id
        AND proof.role = NEW.role
        AND proof.model_canonical_name = desired.canonical_name
        AND proof.model_digest_sha256 = desired.digest_sha256
        AND proof.policy_version = NEW.policy_version
        AND proof.completed_at_ms <= NEW.created_at_ms
        AND proof.expires_at_ms > NEW.created_at_ms
        AND NEW.desired_model_name = desired.model_name
        AND NEW.desired_digest_sha256 = desired.digest_sha256
        AND proof.result = 'PASS'
    )
    BEGIN
      SELECT RAISE(ABORT, 'verified restore event requires matching fresh desired proof');
    END;
CREATE TRIGGER trg_model_failover_state_active_proof_insert
    BEFORE INSERT ON model_failover_state
    WHEN NEW.active_failover = 1 AND NOT EXISTS (
      SELECT 1 FROM model_failover_proofs proof
      WHERE proof.proof_id = NEW.proof_id
        AND proof.role = NEW.role
        AND proof.model_canonical_name = NEW.fallback_canonical_name
        AND proof.model_digest_sha256 = NEW.fallback_digest_sha256
        AND proof.policy_version = NEW.policy_version
        AND proof.completed_at_ms <= NEW.proof_verified_at_ms
        AND proof.expires_at_ms > NEW.proof_verified_at_ms
        AND proof.result = 'PASS'
    )
    BEGIN
      SELECT RAISE(ABORT, 'active failover requires matching digest-bound proof');
    END;
CREATE TRIGGER trg_model_failover_state_active_proof_update
    BEFORE UPDATE ON model_failover_state
    WHEN NEW.active_failover = 1 AND NOT EXISTS (
      SELECT 1 FROM model_failover_proofs proof
      WHERE proof.proof_id = NEW.proof_id
        AND proof.role = NEW.role
        AND proof.model_canonical_name = NEW.fallback_canonical_name
        AND proof.model_digest_sha256 = NEW.fallback_digest_sha256
        AND proof.policy_version = NEW.policy_version
        AND proof.completed_at_ms <= NEW.proof_verified_at_ms
        AND proof.expires_at_ms > NEW.proof_verified_at_ms
        AND proof.result = 'PASS'
    )
    BEGIN
      SELECT RAISE(ABORT, 'active failover requires matching digest-bound proof');
    END;
CREATE TABLE model_evaluation_runs (
      run_id TEXT PRIMARY KEY
        CHECK (length(trim(run_id)) BETWEEN 1 AND 128),
      model_name TEXT NOT NULL
        CHECK (length(trim(model_name)) BETWEEN 1 AND 512),
      model_canonical_name TEXT NOT NULL
        CHECK (length(trim(model_canonical_name)) BETWEEN 1 AND 512),
      model_digest_sha256 TEXT
        CHECK (
          model_digest_sha256 IS NULL OR (
            length(model_digest_sha256) = 64
            AND model_digest_sha256 = lower(model_digest_sha256)
            AND model_digest_sha256 NOT GLOB '*[^0-9a-f]*'
          )
        ),
      suite_name TEXT NOT NULL
        CHECK (length(trim(suite_name)) BETWEEN 1 AND 128),
      suite_version TEXT NOT NULL
        CHECK (length(trim(suite_version)) BETWEEN 1 AND 128),
      suite_contract_sha256 TEXT NOT NULL
        CHECK (
          length(suite_contract_sha256) = 64
          AND suite_contract_sha256 = lower(suite_contract_sha256)
          AND suite_contract_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
      role TEXT
        CHECK (role IS NULL OR length(trim(role)) BETWEEN 1 AND 16),
      status TEXT NOT NULL
        CHECK (status IN ('COMPLETE', 'FAILED', 'BLOCKED')),
      score REAL
        CHECK (score IS NULL OR (score >= 0.0 AND score <= 1.0)),
      passed INTEGER NOT NULL DEFAULT 0
        CHECK (typeof(passed) = 'integer' AND passed >= 0),
      total INTEGER NOT NULL DEFAULT 0
        CHECK (typeof(total) = 'integer' AND total >= 0),
      repeats INTEGER NOT NULL DEFAULT 1
        CHECK (typeof(repeats) = 'integer' AND repeats >= 1),
      duration_ms INTEGER NOT NULL DEFAULT 0
        CHECK (typeof(duration_ms) = 'integer' AND duration_ms >= 0),
      tokens_per_second REAL
        CHECK (tokens_per_second IS NULL OR tokens_per_second >= 0),
      vram_bytes INTEGER
        CHECK (vram_bytes IS NULL OR (typeof(vram_bytes) = 'integer' AND vram_bytes >= 0)),
      task_results_json TEXT NOT NULL DEFAULT '[]'
        CHECK (json_valid(task_results_json)),
      hardware_json TEXT NOT NULL DEFAULT '{}'
        CHECK (json_valid(hardware_json)),
      metadata_json TEXT NOT NULL DEFAULT '{}'
        CHECK (json_valid(metadata_json)),
      error_code TEXT,
      error_message TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      CHECK (status <> 'COMPLETE' OR (model_digest_sha256 IS NOT NULL AND score IS NOT NULL))
    );
CREATE UNIQUE INDEX idx_model_eval_complete_artifact_contract
      ON model_evaluation_runs(
        model_digest_sha256,
        suite_name,
        suite_contract_sha256
      )
      WHERE status = 'COMPLETE';
CREATE INDEX idx_model_eval_model_history
      ON model_evaluation_runs(model_canonical_name, completed_at DESC);
CREATE INDEX idx_model_eval_suite_history
      ON model_evaluation_runs(suite_name, suite_contract_sha256, completed_at DESC);
CREATE TRIGGER trg_model_evaluation_runs_no_update
    BEFORE UPDATE ON model_evaluation_runs
    BEGIN
      SELECT RAISE(ABORT, 'model_evaluation_runs is append-only');
    END;
CREATE TRIGGER trg_model_evaluation_runs_no_delete
    BEFORE DELETE ON model_evaluation_runs
    BEGIN
      SELECT RAISE(ABORT, 'model_evaluation_runs is append-only');
    END;
INSERT INTO schema_migrations VALUES('2026_02_14_001_baseline','2026-08-02 20:02:17');
INSERT INTO schema_migrations VALUES('2026_02_14_002_v59_is_external','2026-08-02 20:02:17');
INSERT INTO schema_migrations VALUES('2026_02_14_003_v62_active_session','2026-08-02 20:02:17');
INSERT INTO schema_migrations VALUES('2026_02_14_004_v63_execution_trace','2026-08-02 20:02:17');
INSERT INTO schema_migrations VALUES('2026_02_14_005_v64_cre_override_log','2026-08-02 20:02:17');
INSERT INTO schema_migrations VALUES('2026_02_18_006','2026-08-02 20:02:17');
INSERT INTO schema_migrations VALUES('2026_02_19_007','2026-08-02 20:02:17');
INSERT INTO schema_migrations VALUES('2026_02_19_008','2026-08-02 20:02:17');
INSERT INTO schema_migrations VALUES('2026_02_20_008','2026-08-02 20:02:17');
INSERT INTO schema_migrations VALUES('2026_02_20_009','2026-08-02 20:02:17');
INSERT INTO schema_migrations VALUES('2026_02_22_010','2026-08-02 20:02:17');
INSERT INTO schema_migrations VALUES('2026_02_22_011','2026-08-02 20:02:17');
INSERT INTO schema_migrations VALUES('2026_02_22_012','2026-08-02 20:02:17');
INSERT INTO schema_migrations VALUES('2026_02_24_013','2026-08-02 20:02:17');
INSERT INTO schema_migrations VALUES('2026_02_24_014','2026-08-02 20:02:17');
INSERT INTO schema_migrations VALUES('2026_02_24_015','2026-08-02 20:02:17');
INSERT INTO schema_migrations VALUES('2026_02_24_016','2026-08-02 20:02:17');
INSERT INTO schema_migrations VALUES('2026_02_24_017','2026-08-02 20:02:17');
INSERT INTO schema_migrations VALUES('2026_02_25_018','2026-08-02 20:02:17');
INSERT INTO schema_migrations VALUES('2026_02_26_019','2026-08-02 20:02:17');
INSERT INTO schema_migrations VALUES('2026_02_26_020','2026-08-02 20:02:17');
INSERT INTO schema_migrations VALUES('2026_02_27_021','2026-08-02 20:02:17');
INSERT INTO schema_migrations VALUES('2026_02_27_022','2026-08-02 20:02:17');
INSERT INTO schema_migrations VALUES('2026_02_28_023','2026-08-02 20:02:17');
INSERT INTO schema_migrations VALUES('2026_03_01_024','2026-08-02 20:02:17');
INSERT INTO schema_migrations VALUES('2026_03_01_025','2026-08-02 20:02:17');
INSERT INTO schema_migrations VALUES('2026_03_02_026','2026-08-02 20:02:17');
INSERT INTO schema_migrations VALUES('2026_03_03_027_v91_feedback','2026-08-02 20:02:17');
INSERT INTO schema_migrations VALUES('2026_03_03_028_v91_feedback_attachments','2026-08-02 20:02:17');
INSERT INTO schema_migrations VALUES('2026_03_05_029_v98_architecture_governance','2026-08-02 20:02:17');
INSERT INTO schema_migrations VALUES('2026_03_08_030_v103_model_overrides','2026-08-02 20:02:17');
INSERT INTO schema_migrations VALUES('2026_03_08_030_v107_task_memory','2026-08-02 20:02:17');
INSERT INTO schema_migrations VALUES('2026_03_10_031_v118_upgrade_proposals','2026-08-02 20:02:17');
INSERT INTO schema_migrations VALUES('2026_03_11_032_v120_model_performance','2026-08-02 20:02:17');
INSERT INTO schema_migrations VALUES('2026_03_11_033_v121_discovered_models','2026-08-02 20:02:17');
INSERT INTO schema_migrations VALUES('2026_03_12_034_v123_validation_results','2026-08-02 20:02:17');
INSERT INTO schema_migrations VALUES('2026_03_12_035_v124_marketplace','2026-08-02 20:02:17');
INSERT INTO schema_migrations VALUES('2026_03_12_036_v125_model_verified','2026-08-02 20:02:17');
INSERT INTO schema_migrations VALUES('2026_03_22_037_v130_media_generations','2026-08-02 20:02:17');
INSERT INTO schema_migrations VALUES('2026_03_25_038_v132_benchmark_source','2026-08-02 20:02:17');
INSERT INTO schema_migrations VALUES('2026_03_26_039_v133_model_usage','2026-08-02 20:02:17');
INSERT INTO schema_migrations VALUES('2026_03_27_040_v135_governor','2026-08-02 20:02:17');
INSERT INTO schema_migrations VALUES('2026_04_08_041_v136_model_universe','2026-08-02 20:02:17');
INSERT INTO schema_migrations VALUES('2026_04_08_042_v137_universe_reconciliation','2026-08-02 20:02:17');
INSERT INTO schema_migrations VALUES('2026_04_12_043_drafts_table','2026-08-02 20:02:17');
INSERT INTO schema_migrations VALUES('2026_04_12_044_v138_runtime_guard','2026-08-02 20:02:17');
INSERT INTO schema_migrations VALUES('2026_07_30_045_telemetry_aggregation_version','2026-08-02 20:02:17');
INSERT INTO schema_migrations VALUES('2026_08_08_046_model_failover','2026-08-10 18:36:19');
INSERT INTO schema_migrations VALUES('2026_08_08_047_model_failover_claim_expiry','2026-08-10 18:36:19');
INSERT INTO schema_migrations VALUES('2026_08_08_048_model_binding_operations','2026-08-10 18:36:19');
INSERT INTO schema_migrations VALUES('2026_08_08_049_model_binding_manual_supersede','2026-08-10 18:36:19');
INSERT INTO schema_migrations VALUES('2026_08_09_050_model_binding_application_attempts','2026-08-10 18:36:19');
INSERT INTO schema_migrations VALUES('2026_08_09_051_model_binding_runtime_generation','2026-08-10 18:36:19');
INSERT INTO schema_migrations VALUES('2026_08_09_052_model_binding_provider_effects','2026-08-10 18:36:19');
INSERT INTO schema_migrations VALUES('2026_08_09_053_model_binding_append_only_identity','2026-08-10 18:36:19');
INSERT INTO schema_migrations VALUES('2026_08_09_054_model_binding_runtime_finalization','2026-08-10 18:36:19');
INSERT INTO schema_migrations VALUES('2026_08_09_061_model_automation_policy','2026-08-10 18:36:19');
INSERT INTO schema_migrations VALUES('2026_08_10_062_model_failover_proof_issuance','2026-08-10 18:36:19');
INSERT INTO schema_migrations VALUES('2026_08_22_066_model_automation_policy','2026-08-22 16:13:28');
INSERT INTO schema_migrations VALUES('2026_08_22_067_model_failover_proof_artifacts','2026-08-22 16:13:28');
INSERT INTO schema_migrations VALUES('2026_08_22_068_model_evaluation_history','2026-08-22 21:51:35');
INSERT INTO schema_migrations VALUES('2026_08_22_070_model_evaluation_history','2026-08-23 12:26:37');
