// Lifecycle E2E Test — Android Mobile App (FitTracker)
// ══════════════════════════════════════════════════════════════════════════════
// Real scenario: User in C3 IDE creates a Flutter Android fitness tracking app.
// Full lifecycle: PROPOSED → SPEC → SPEC_REVIEW → PLAN_REVIEW → BUILD (3 ms) → COMPLETED
//
// Project: FitTracker — workout logging app
//   ms-1: Project setup + data models (pubspec.yaml, lib/models/workout.dart)
//   ms-2: UI screens (home, workout detail, workout card widget)
//   ms-3: Data persistence + statistics screen
//
// Run: node tests/lifecycle-android-app-e2e.test.js
// ══════════════════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

import {
  ProjectPhase,
  MilestoneStatus,
  ProjectLifecycle,
  getBuildProgress,
  computeLifecycleProgress,
  formatLifecycleProgress,
  formatMilestoneTable,
} from '../src/planner/index.js';

import {
  lifecycles as lifecycleRepo,
  milestones as msRepo,
  roadmapVersions,
  projects,
  lifecycleHandoffState,
  db,
} from '../src/db/database.js';

import {
  handleLifecycleBuildDetected,
  handleLifecycleInput,
} from '../src/chat/handlers/lifecycle-handoff.js';

import { getLcState, setLcState, clearLcState, initLifecycleStateDb } from '../src/chat/handlers/lifecycle-state.js';
import { startNextMilestone } from '../src/planner/lifecycle-build.js';
import { domainRegistry } from '../src/domains/index.js';

// ─── Test Infra ─────────────────────────────────────────────────────────────

const transcript = [];
let turnNum = 0;
let passed = 0;
let failed = 0;
const failures = [];

function userTurn(message) {
  turnNum++;
  transcript.push({ turn: turnNum, role: 'USER', content: message });
  console.log(`\n${'─'.repeat(70)}`);
  console.log(` TURN ${turnNum} │ USER`);
  console.log(`${'─'.repeat(70)}`);
  console.log(message);
  return message;
}

function systemTurn(phase, response) {
  turnNum++;
  const content = typeof response === 'string' ? response : (response?.content || JSON.stringify(response));
  transcript.push({ turn: turnNum, role: 'SYSTEM', phase, content });
  console.log(`\n${'─'.repeat(70)}`);
  console.log(` TURN ${turnNum} │ SYSTEM — Phase: ${phase}`);
  console.log(`${'─'.repeat(70)}`);
  console.log(content?.substring(0, 500) + (content?.length > 500 ? '\n  ...(truncated)' : ''));
}

function check(condition, name, detail = '') {
  if (condition) {
    passed++;
    console.log(`    ✅ ${name}`);
  } else {
    failed++;
    console.log(`    ❌ ${name}: ${detail}`);
    failures.push({ name, detail });
  }
}

// ─── Sample Data — FitTracker ────────────────────────────────────────────────

const SAMPLE_SPEC = {
  title: 'FitTracker — Workout Logging App',
  goals: [
    { id: 'G1', description: 'Log workouts with exercises and sets', priority: 'MUST', success_criteria: 'User can create a workout, add exercises, and log sets (reps + weight)' },
    { id: 'G2', description: 'View workout history with statistics', priority: 'MUST', success_criteria: 'User sees a list of past workouts with date, duration, and total volume' },
    { id: 'G3', description: 'Persist data locally on device', priority: 'MUST', success_criteria: 'Data survives app restart via SQLite (sqflite)' },
  ],
  requirements: [
    { id: 'R1', description: 'Workout creation screen with exercise list', type: 'functional', goal_id: 'G1', acceptance_test: 'Create workout, add exercise, verify it appears in list' },
    { id: 'R2', description: 'Set logging: reps, weight, rest timer', type: 'functional', goal_id: 'G1', acceptance_test: 'Log a set with 10 reps x 50kg, verify displayed correctly' },
    { id: 'R3', description: 'Home screen showing recent workouts', type: 'functional', goal_id: 'G2', acceptance_test: 'Add 3 workouts, verify all 3 visible on home screen' },
    { id: 'R4', description: 'Statistics: total volume, frequency chart', type: 'functional', goal_id: 'G2', acceptance_test: 'Add workouts, open stats, verify volume and count shown' },
    { id: 'R5', description: 'SQLite persistence with sqflite package', type: 'functional', goal_id: 'G3', acceptance_test: 'Add workout, restart app, verify workout still visible' },
  ],
  tech_stack: {
    languages: ['Dart'],
    frameworks: ['Flutter'],
    tools: ['sqflite', 'Material Design 3'],
    rationale: 'Flutter for cross-platform Android/iOS with native performance. sqflite for local persistence.',
  },
  architecture: {
    pattern: 'Feature-first with services layer',
    components: ['models/', 'screens/', 'services/', 'widgets/'],
    data_model: 'workouts (id, date, duration_min), exercises (id, workout_id, name), sets (id, exercise_id, reps, weight_kg)',
  },
  risks: [
    { id: 'RISK1', description: 'sqflite async initialization can cause race conditions', severity: 'MEDIUM', mitigation: 'Singleton DB service with async init guard' },
  ],
  constraints: ['Offline-first — no backend API required'],
  out_of_scope: ['Cloud sync', 'Social features', 'iOS-specific UI'],
  design_decisions: [
    { id: 'DD1', decision: 'State management', chosen: 'StatefulWidget + ChangeNotifier', alternatives_considered: ['Riverpod', 'BLoC'], rationale: 'Simplest approach for this scope — no complex state sharing' },
  ],
  acceptance_criteria: [
    'Workouts can be created, viewed, and include multiple exercises with sets',
    'Data persists across app restarts',
    'Home screen shows recent workouts with basic stats',
  ],
};

const SAMPLE_ROADMAP = {
  milestones: [
    {
      id: 'ms-1',
      title: 'Project Setup + Data Models',
      description: 'Flutter project scaffold with pubspec.yaml and Dart data models',
      dependencies: [],
      estimated_loc: 150,
      estimated_files: 3,
      estimated_complexity: 'LOW',
      goals_addressed: ['G3'],
      requirements_addressed: ['R5'],
      deliverables: ['pubspec.yaml', 'lib/models/workout.dart', 'lib/services/database.dart'],
    },
    {
      id: 'ms-2',
      title: 'UI Screens',
      description: 'Home screen with workout list and workout detail screen for logging',
      dependencies: ['ms-1'],
      estimated_loc: 300,
      estimated_files: 4,
      estimated_complexity: 'MEDIUM',
      goals_addressed: ['G1', 'G2'],
      requirements_addressed: ['R1', 'R2', 'R3'],
      deliverables: ['lib/main.dart', 'lib/screens/home.dart', 'lib/screens/workout_detail.dart', 'lib/widgets/workout_card.dart'],
    },
    {
      id: 'ms-3',
      title: 'Statistics + Persistence Integration',
      description: 'Statistics screen with workout frequency and volume charts, full DB integration',
      dependencies: ['ms-2'],
      estimated_loc: 200,
      estimated_files: 2,
      estimated_complexity: 'MEDIUM',
      goals_addressed: ['G2', 'G3'],
      requirements_addressed: ['R4', 'R5'],
      deliverables: ['lib/screens/stats.dart', 'lib/services/stats_service.dart'],
    },
  ],
  total_estimated_loc: 650,
  total_milestones: 3,
  critical_path: ['ms-1', 'ms-2', 'ms-3'],
};

const MILESTONE_PLANS = {
  'ms-1': {
    milestone_id: 'ms-1',
    files: [
      { path: 'pubspec.yaml', action: 'create', purpose: 'Flutter project manifest with sqflite dependency' },
      { path: 'lib/models/workout.dart', action: 'create', purpose: 'Workout, Exercise, ExerciseSet data classes' },
      { path: 'lib/services/database.dart', action: 'create', purpose: 'SQLite DB service (singleton, async init)' },
    ],
    implementation_steps: [
      { step: 1, action: 'Create pubspec.yaml with flutter, sqflite, path_provider deps', file: 'pubspec.yaml' },
      { step: 2, action: 'Create Workout, Exercise, ExerciseSet model classes with toMap/fromMap', file: 'lib/models/workout.dart' },
      { step: 3, action: 'Create DatabaseService singleton with CREATE TABLE statements', file: 'lib/services/database.dart' },
    ],
    scope_files: ['pubspec.yaml', 'lib/models/workout.dart', 'lib/services/database.dart'],
    rollback_strategy: 'Delete created files',
  },
  'ms-2': {
    milestone_id: 'ms-2',
    files: [
      { path: 'lib/main.dart', action: 'create', purpose: 'App entry point with MaterialApp + routing' },
      { path: 'lib/screens/home.dart', action: 'create', purpose: 'Home screen with workout list' },
      { path: 'lib/screens/workout_detail.dart', action: 'create', purpose: 'Workout detail screen for logging sets' },
      { path: 'lib/widgets/workout_card.dart', action: 'create', purpose: 'Workout list item card widget' },
    ],
    implementation_steps: [
      { step: 1, action: 'Create main.dart with MaterialApp and theme', file: 'lib/main.dart' },
      { step: 2, action: 'Create HomeScreen with ListView of workouts', file: 'lib/screens/home.dart' },
      { step: 3, action: 'Create WorkoutDetailScreen with exercise + set forms', file: 'lib/screens/workout_detail.dart' },
      { step: 4, action: 'Create WorkoutCard widget', file: 'lib/widgets/workout_card.dart' },
    ],
    scope_files: ['lib/main.dart', 'lib/screens/home.dart', 'lib/screens/workout_detail.dart', 'lib/widgets/workout_card.dart'],
    rollback_strategy: 'Delete created files',
  },
  'ms-3': {
    milestone_id: 'ms-3',
    files: [
      { path: 'lib/screens/stats.dart', action: 'create', purpose: 'Statistics screen with volume/frequency charts' },
      { path: 'lib/services/stats_service.dart', action: 'create', purpose: 'Statistics calculation service' },
    ],
    implementation_steps: [
      { step: 1, action: 'Create StatsService with volume and frequency calculations', file: 'lib/services/stats_service.dart' },
      { step: 2, action: 'Create StatsScreen with charts', file: 'lib/screens/stats.dart' },
    ],
    scope_files: ['lib/screens/stats.dart', 'lib/services/stats_service.dart'],
    rollback_strategy: 'Delete created files',
  },
};

// ─── Project Files (real Dart code) ─────────────────────────────────────────

const PROJECT_FILES = {
  'ms-1': {
    'pubspec.yaml': `name: fittracker
description: Workout logging app for Android.
version: 1.0.0

environment:
  sdk: '>=3.2.0 <4.0.0'

dependencies:
  flutter:
    sdk: flutter
  sqflite: ^2.3.0
  path_provider: ^2.1.0
  cupertino_icons: ^1.0.6

dev_dependencies:
  flutter_test:
    sdk: flutter

flutter:
  uses-material-design: true
`,
    'lib/models/workout.dart': `class ExerciseSet {
  final int? id;
  final int exerciseId;
  final int reps;
  final double weightKg;

  ExerciseSet({this.id, required this.exerciseId, required this.reps, required this.weightKg});

  Map<String, dynamic> toMap() => {
    'id': id, 'exercise_id': exerciseId, 'reps': reps, 'weight_kg': weightKg,
  };

  factory ExerciseSet.fromMap(Map<String, dynamic> map) => ExerciseSet(
    id: map['id'], exerciseId: map['exercise_id'], reps: map['reps'],
    weightKg: (map['weight_kg'] as num).toDouble(),
  );
}

class Exercise {
  final int? id;
  final int workoutId;
  final String name;
  List<ExerciseSet> sets;

  Exercise({this.id, required this.workoutId, required this.name, this.sets = const []});

  Map<String, dynamic> toMap() => {'id': id, 'workout_id': workoutId, 'name': name};

  factory Exercise.fromMap(Map<String, dynamic> map) => Exercise(
    id: map['id'], workoutId: map['workout_id'], name: map['name'],
  );
}

class Workout {
  final int? id;
  final DateTime date;
  final int durationMin;
  List<Exercise> exercises;

  Workout({this.id, required this.date, required this.durationMin, this.exercises = const []});

  double get totalVolume => exercises.fold(0.0, (sum, ex) =>
    sum + ex.sets.fold(0.0, (s, set) => s + set.reps * set.weightKg));

  Map<String, dynamic> toMap() => {
    'id': id, 'date': date.toIso8601String(), 'duration_min': durationMin,
  };

  factory Workout.fromMap(Map<String, dynamic> map) => Workout(
    id: map['id'], date: DateTime.parse(map['date']), durationMin: map['duration_min'],
  );
}
`,
    'lib/services/database.dart': `import 'package:sqflite/sqflite.dart';
import 'package:path/path.dart';
import '../models/workout.dart';

class DatabaseService {
  static final DatabaseService _instance = DatabaseService._();
  static Database? _db;

  DatabaseService._();
  factory DatabaseService() => _instance;

  Future<Database> get database async {
    _db ??= await _initDb();
    return _db!;
  }

  Future<Database> _initDb() async {
    final path = join(await getDatabasesPath(), 'fittracker.db');
    return openDatabase(path, version: 1, onCreate: (db, version) async {
      await db.execute('''
        CREATE TABLE workouts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          date TEXT NOT NULL,
          duration_min INTEGER DEFAULT 0
        )
      ''');
      await db.execute('''
        CREATE TABLE exercises (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          workout_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          FOREIGN KEY (workout_id) REFERENCES workouts(id)
        )
      ''');
      await db.execute('''
        CREATE TABLE sets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          exercise_id INTEGER NOT NULL,
          reps INTEGER NOT NULL,
          weight_kg REAL NOT NULL,
          FOREIGN KEY (exercise_id) REFERENCES exercises(id)
        )
      ''');
    });
  }

  Future<int> insertWorkout(Workout w) async {
    final db = await database;
    return db.insert('workouts', w.toMap());
  }

  Future<List<Workout>> getWorkouts() async {
    final db = await database;
    final rows = await db.query('workouts', orderBy: 'date DESC');
    return rows.map(Workout.fromMap).toList();
  }
}
`,
  },
  'ms-2': {
    'lib/main.dart': `import 'package:flutter/material.dart';
import 'screens/home.dart';

void main() => runApp(const FitTrackerApp());

class FitTrackerApp extends StatelessWidget {
  const FitTrackerApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'FitTracker',
      theme: ThemeData(colorSchemeSeed: Colors.orange, useMaterial3: true),
      home: const HomeScreen(),
    );
  }
}
`,
    'lib/screens/home.dart': `import 'package:flutter/material.dart';
import '../widgets/workout_card.dart';
import '../services/database.dart';
import '../models/workout.dart';
import 'workout_detail.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});
  @override State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  List<Workout> _workouts = [];

  @override
  void initState() { super.initState(); _loadWorkouts(); }

  Future<void> _loadWorkouts() async {
    final workouts = await DatabaseService().getWorkouts();
    setState(() => _workouts = workouts);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('FitTracker')),
      body: _workouts.isEmpty
        ? const Center(child: Text('No workouts yet. Tap + to start!'))
        : ListView.builder(
            itemCount: _workouts.length,
            itemBuilder: (ctx, i) => WorkoutCard(workout: _workouts[i]),
          ),
      floatingActionButton: FloatingActionButton(
        onPressed: () => Navigator.push(context,
          MaterialPageRoute(builder: (_) => const WorkoutDetailScreen())),
        child: const Icon(Icons.add),
      ),
    );
  }
}
`,
    'lib/screens/workout_detail.dart': `import 'package:flutter/material.dart';
import '../models/workout.dart';
import '../services/database.dart';

class WorkoutDetailScreen extends StatefulWidget {
  const WorkoutDetailScreen({super.key});
  @override State<WorkoutDetailScreen> createState() => _WorkoutDetailScreenState();
}

class _WorkoutDetailScreenState extends State<WorkoutDetailScreen> {
  final List<Map<String, dynamic>> _exercises = [];

  void _addExercise() {
    setState(() => _exercises.add({'name': '', 'sets': <Map<String, dynamic>>[]}));
  }

  Future<void> _saveWorkout() async {
    final workout = Workout(date: DateTime.now(), durationMin: 0);
    await DatabaseService().insertWorkout(workout);
    if (mounted) Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('New Workout'),
        actions: [IconButton(icon: const Icon(Icons.save), onPressed: _saveWorkout)],
      ),
      body: ListView(children: [
        ..._exercises.map((ex) => ListTile(title: Text(ex['name'] as String? ?? 'Exercise'))),
        TextButton.icon(icon: const Icon(Icons.add), label: const Text('Add exercise'), onPressed: _addExercise),
      ]),
    );
  }
}
`,
    'lib/widgets/workout_card.dart': `import 'package:flutter/material.dart';
import '../models/workout.dart';

class WorkoutCard extends StatelessWidget {
  final Workout workout;
  const WorkoutCard({super.key, required this.workout});

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: ListTile(
        leading: const Icon(Icons.fitness_center, color: Colors.orange),
        title: Text(workout.date.toString().substring(0, 10)),
        subtitle: Text('\${workout.durationMin} min — \${workout.exercises.length} exercises'),
        trailing: Text('\${workout.totalVolume.toStringAsFixed(0)} kg'),
      ),
    );
  }
}
`,
  },
  'ms-3': {
    'lib/services/stats_service.dart': `import '../services/database.dart';
import '../models/workout.dart';

class StatsService {
  final DatabaseService _db = DatabaseService();

  Future<double> totalVolumeLast30Days() async {
    final workouts = await _db.getWorkouts();
    final cutoff = DateTime.now().subtract(const Duration(days: 30));
    return workouts
      .where((w) => w.date.isAfter(cutoff))
      .fold(0.0, (sum, w) => sum + w.totalVolume);
  }

  Future<int> workoutCountLast30Days() async {
    final workouts = await _db.getWorkouts();
    final cutoff = DateTime.now().subtract(const Duration(days: 30));
    return workouts.where((w) => w.date.isAfter(cutoff)).length;
  }

  Future<Map<String, int>> weeklyFrequency() async {
    final workouts = await _db.getWorkouts();
    final freq = <String, int>{};
    for (final w in workouts) {
      final week = '\${w.date.year}-W\${(w.date.day / 7).ceil().toString().padLeft(2, '0')}';
      freq[week] = (freq[week] ?? 0) + 1;
    }
    return freq;
  }
}
`,
    'lib/screens/stats.dart': `import 'package:flutter/material.dart';
import '../services/stats_service.dart';

class StatsScreen extends StatefulWidget {
  const StatsScreen({super.key});
  @override State<StatsScreen> createState() => _StatsScreenState();
}

class _StatsScreenState extends State<StatsScreen> {
  final StatsService _stats = StatsService();
  double _totalVolume = 0;
  int _workoutCount = 0;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    final vol = await _stats.totalVolumeLast30Days();
    final cnt = await _stats.workoutCountLast30Days();
    setState(() { _totalVolume = vol; _workoutCount = cnt; });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Statistics')),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(children: [
          _StatCard(label: 'Total Volume (30d)', value: '\${_totalVolume.toStringAsFixed(0)} kg'),
          const SizedBox(height: 16),
          _StatCard(label: 'Workouts (30d)', value: '\$_workoutCount'),
        ]),
      ),
    );
  }
}

class _StatCard extends StatelessWidget {
  final String label;
  final String value;
  const _StatCard({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(children: [
          Text(value, style: Theme.of(context).textTheme.headlineMedium),
          const SizedBox(height: 8),
          Text(label, style: Theme.of(context).textTheme.bodyLarge),
        ]),
      ),
    );
  }
}
`,
  },
};

// ─── Fake LLM ────────────────────────────────────────────────────────────────

function createFakeLLM() {
  return async function fakeLLM(role, prompt) {
    const p = typeof prompt === 'string' ? prompt : JSON.stringify(prompt);

    if (p.includes('## User Request') || p.includes('clarifying questions')) {
      return {
        content: JSON.stringify({
          core_goal: 'Workout logging Android app with local persistence',
          clarifying_questions: [
            'Jaké cviky chceš logovat? (custom / předdefinované)',
            'Potřebuješ timer na pauzy mezi sety?',
            'Chceš grafy (frequency chart) nebo stačí čísla?',
          ],
          initial_assessment: {
            estimated_complexity: 'MEDIUM',
            key_risks: ['sqflite async init race condition'],
            suggested_tech_stack: ['Flutter', 'Dart', 'sqflite'],
          },
        }),
      };
    }

    if (p.includes('thorough project specification') || p.includes('creating a project specification') || p.includes('structured project specification')) {
      return { content: JSON.stringify(SAMPLE_SPEC) };
    }

    if (p.includes('creating a project roadmap') || p.includes('Break the project into milestones')) {
      return { content: JSON.stringify(SAMPLE_ROADMAP) };
    }

    if (p.includes('implementing a specific milestone') || p.includes('implementation plan for THIS milestone')) {
      const msIdMatch = p.match(/"id"\s*:\s*"(ms-\d+)"/);
      const msId = msIdMatch ? msIdMatch[1] : 'ms-1';
      return { content: JSON.stringify(MILESTONE_PLANS[msId] || MILESTONE_PLANS['ms-1']) };
    }

    if (p.includes('reviewing a completed milestone') || p.includes('Compare the actual output')) {
      return {
        content: JSON.stringify({
          passed: true,
          deliverables_check: [{ deliverable: 'Files created', status: 'DONE', note: 'All expected files present' }],
          scope_violations: [],
          test_summary: { total: 4, passed: 4, failed: 0, coverage_estimate: '75%' },
          quality_notes: ['Clean Dart code, follows Flutter conventions'],
          overall_assessment: 'Milestone completed successfully',
        }),
      };
    }

    if (p.includes('computing health metrics') || p.includes('health metrics for a completed milestone')) {
      return {
        content: JSON.stringify({
          scope_adherence: 0.92,
          test_coverage: 0.75,
          complexity_delta: 0.15,
          tech_debt_delta: 0.08,
        }),
      };
    }

    if (p.includes('conducting a project review') || p.includes('4 drift checks')) {
      return {
        content: JSON.stringify({
          spec_alignment: { addressed_goals: ['G1', 'G2', 'G3'], unaddressed_goals: [], missed_requirements: [], confidence: 0.90 },
          scope_creep: { in_scope: ['Models', 'Screens', 'DB', 'Stats'], out_of_scope: [], severity: 'NONE', confidence: 0.92 },
          architecture_consistency: { consistent: true, violations: [], confidence: 0.88 },
          tech_debt: { items: [], trend: 'STABLE', confidence: 0.80 },
          overall_health: 'GREEN',
          recommendations: ['Consider adding input validation for sets'],
        }),
      };
    }

    console.warn(`    ⚠️ fakeLLM: unmatched prompt (role=${role})`);
    return { content: '{}' };
  };
}

// ─── Fake Executor ──────────────────────────────────────────────────────────

function createFakeExecutor(projectPath) {
  return {
    async start(request, context) {
      const msId = context.milestoneId;
      const files = PROJECT_FILES[msId] || {};

      for (const [relPath, content] of Object.entries(files)) {
        const fullPath = path.join(projectPath, relPath);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, content);
      }

      try {
        execSync('git add -A', { cwd: projectPath, stdio: 'pipe' });
        execSync(`git commit -m "executor: ${msId}" --allow-empty`, { cwd: projectPath, stdio: 'pipe' });
      } catch { /* git may fail if no changes */ }

      return { state: 'COMPLETED', sessionId: `mock-wf-${msId}` };
    },
    async approve(sessionId) {
      return { state: 'COMPLETED', sessionId };
    },
  };
}

// ─── DB Cleanup ─────────────────────────────────────────────────────────────

function cleanDB() {
  for (const t of ['lifecycle_handoff_state', 'drift_checks', 'change_requests',
                    'milestones', 'roadmap_versions', 'project_lifecycles']) {
    try { db.prepare(`DELETE FROM ${t}`).run(); } catch { /* ignore */ }
  }
  try { db.prepare(`DELETE FROM projects WHERE path LIKE '/tmp/%'`).run(); } catch { /* ignore */ }
  initLifecycleStateDb(lifecycleHandoffState, lifecycleRepo);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN TEST
// ═══════════════════════════════════════════════════════════════════════════════

async function runTest() {
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log('  Lifecycle E2E: Android Mobile App (FitTracker — Flutter)');
  console.log('══════════════════════════════════════════════════════════════════════');

  cleanDB();

  const SESSION_ID = 'android-app-e2e';
  const projectPath = `/tmp/lc-android-e2e-${Date.now()}`;
  fs.mkdirSync(projectPath, { recursive: true });
  execSync('git init', { cwd: projectPath, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: projectPath, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: projectPath, stdio: 'pipe' });
  execSync('git commit --allow-empty -m "init"', { cwd: projectPath, stdio: 'pipe' });

  const fakeLLM = createFakeLLM();
  const fakeExecutor = createFakeExecutor(projectPath);
  const context = { sessionId: SESSION_ID, callLLM: fakeLLM, executor: fakeExecutor, projectPath };

  try {
    // ═══ PRE-CHECK: Domain Registry has Flutter scaffold ═══════════════════

    console.log('\n\n═══ PRE-CHECK: Domain Registry ══════════════════════════════════════');

    const flutterScaffold = domainRegistry.getScaffold('flutter-app');
    check(flutterScaffold != null, 'P1: flutter-app scaffold exists in registry');
    check(flutterScaffold?.tags?.includes('android'), 'P1: flutter scaffold tagged android');

    const matchResults = domainRegistry.matchRequest('mobilní aplikace pro android fitness tracker');
    check(matchResults.scaffolds.length > 0, 'P2: matchRequest finds scaffolds for android query');
    const flutterMatch = matchResults.scaffolds.find(s => s.id === 'flutter-app');
    check(flutterMatch != null, 'P2: flutter-app matched for android query');

    // ═══ PHASE 1: Detection + Proposal ════════════════════════════════════

    console.log('\n\n═══ PHASE 1: Detection + Proposal ═══════════════════════════════════');

    const userMsg1 = userTurn(
      'Chci postavit kompletní mobilní aplikaci pro Android — fitness tracker na logování tréninků, s databází a statistikami'
    );

    const response1 = handleLifecycleBuildDetected(userMsg1, { intent: 'BUILD' }, context);
    systemTurn('PROPOSED', response1);

    check(response1?.content?.includes('lifecycle'), 'T1: response mentions lifecycle');
    check(response1?.content?.includes('ano/ne'), 'T1: asks for confirmation');
    const state1 = getLcState(SESSION_ID);
    check(state1?.phase === 'PROPOSED', 'T1: state is PROPOSED', `got: ${state1?.phase}`);

    // ═══ PHASE 2: SPEC ═══════════════════════════════════════════════════════

    console.log('\n\n═══ PHASE 2: SPEC ══════════════════════════════════════════════════');

    const userMsg2 = userTurn('ano');
    const response2 = await handleLifecycleInput(userMsg2, context);
    systemTurn('SPEC', response2);

    const state2 = getLcState(SESSION_ID);
    check(state2?.phase === 'SPEC', 'T2: state is SPEC', `got: ${state2?.phase}`);
    check(state2?.lifecycleId != null, 'T2: lifecycleId set');

    // Answer spec questions
    const userMsg3 = userTurn(
      'Custom cviky. Ano, timer na pauzy. Stačí čísla, grafy nepotřebuji.'
    );
    const response3 = await handleLifecycleInput(userMsg3, context);
    systemTurn('SPEC_REVIEW', response3);

    const state3 = getLcState(SESSION_ID);
    check(state3?.phase === 'SPEC_REVIEW', 'T3: state is SPEC_REVIEW', `got: ${state3?.phase}`);
    check(response3?.content?.includes('FitTracker') || response3?.content?.includes('Workout'),
      'T3: spec contains project name/theme');

    // ═══ PHASE 3: SPEC_REVIEW → PLANNING ══════════════════════════════════

    console.log('\n\n═══ PHASE 3: SPEC_REVIEW → PLANNING ═════════════════════════════════');

    const userMsg4 = userTurn('schvaluji');
    const response4 = await handleLifecycleInput(userMsg4, context);
    systemTurn('PLAN_REVIEW', response4);

    const state4 = getLcState(SESSION_ID);
    check(state4?.phase === 'PLAN_REVIEW', 'T4: state is PLAN_REVIEW', `got: ${state4?.phase}`);
    check(response4?.content?.includes('ms-1') || response4?.content?.includes('Setup'),
      'T4: roadmap contains ms-1');
    check(response4?.content?.includes('ms-3') || response4?.content?.includes('Statist'),
      'T4: roadmap contains ms-3');

    // ═══ PHASE 4: BUILD — Milestone 1 (Setup + Models) ════════════════════

    console.log('\n\n═══ PHASE 4: BUILD — Milestone 1 ════════════════════════════════════');

    const userMsg5 = userTurn('schvaluji');
    const response5 = await handleLifecycleInput(userMsg5, context);
    systemTurn('BUILD ms-1', response5);

    const state5 = getLcState(SESSION_ID);
    check(state5?.phase === 'BUILD_MILESTONE_REVIEW', 'T5: state is BUILD_MILESTONE_REVIEW',
      `got: ${state5?.phase}`);
    check(state5?.currentMilestoneId === 'ms-1', 'T5: currentMilestoneId is ms-1',
      `got: ${state5?.currentMilestoneId}`);

    // Approve ms-1
    const userMsg6 = userTurn('ano');
    const response6 = await handleLifecycleInput(userMsg6, context);
    systemTurn('BUILD ms-1 result', response6);

    const ms1Db = msRepo.getMilestone('ms-1');
    check(ms1Db?.status === 'PASSED', 'T6: ms-1 PASSED in DB', `got: ${ms1Db?.status}`);

    // Verify Flutter files on disk
    check(fs.existsSync(path.join(projectPath, 'pubspec.yaml')), 'T6: pubspec.yaml exists');
    check(fs.existsSync(path.join(projectPath, 'lib/models/workout.dart')), 'T6: lib/models/workout.dart exists');
    check(fs.existsSync(path.join(projectPath, 'lib/services/database.dart')), 'T6: lib/services/database.dart exists');

    // Verify pubspec content
    const pubspec = fs.readFileSync(path.join(projectPath, 'pubspec.yaml'), 'utf8');
    check(pubspec.includes('sqflite'), 'T6: pubspec.yaml contains sqflite dependency');
    check(pubspec.includes('fittracker'), 'T6: pubspec.yaml has project name');

    // Verify Dart model
    const modelContent = fs.readFileSync(path.join(projectPath, 'lib/models/workout.dart'), 'utf8');
    check(modelContent.includes('class Workout'), 'T6: workout.dart has Workout class');
    check(modelContent.includes('class ExerciseSet'), 'T6: workout.dart has ExerciseSet class');
    check(modelContent.includes('totalVolume'), 'T6: workout.dart has totalVolume getter');

    // ═══ PHASE 5: BUILD — Milestone 2 (UI Screens) ═══════════════════════

    console.log('\n\n═══ PHASE 5: BUILD — Milestone 2 ════════════════════════════════════');

    const state6 = getLcState(SESSION_ID);
    check(state6?.currentMilestoneId === 'ms-2', 'T7: auto-advanced to ms-2',
      `got: ${state6?.currentMilestoneId}`);

    const userMsg7 = userTurn('ano');
    const response7 = await handleLifecycleInput(userMsg7, context);
    systemTurn('BUILD ms-2 result', response7);

    const ms2Db = msRepo.getMilestone('ms-2');
    check(ms2Db?.status === 'PASSED', 'T8: ms-2 PASSED in DB', `got: ${ms2Db?.status}`);

    check(fs.existsSync(path.join(projectPath, 'lib/main.dart')), 'T8: lib/main.dart exists');
    check(fs.existsSync(path.join(projectPath, 'lib/screens/home.dart')), 'T8: lib/screens/home.dart exists');
    check(fs.existsSync(path.join(projectPath, 'lib/screens/workout_detail.dart')), 'T8: workout_detail.dart exists');
    check(fs.existsSync(path.join(projectPath, 'lib/widgets/workout_card.dart')), 'T8: workout_card.dart exists');

    // Verify Flutter widget code
    const mainDart = fs.readFileSync(path.join(projectPath, 'lib/main.dart'), 'utf8');
    check(mainDart.includes('FitTrackerApp'), 'T8: main.dart has FitTrackerApp');
    check(mainDart.includes('MaterialApp'), 'T8: main.dart uses MaterialApp');

    const homeDart = fs.readFileSync(path.join(projectPath, 'lib/screens/home.dart'), 'utf8');
    check(homeDart.includes('HomeScreen'), 'T8: home.dart has HomeScreen');
    check(homeDart.includes('WorkoutCard'), 'T8: home.dart uses WorkoutCard widget');

    // ═══ PHASE 6: BUILD — Milestone 3 (Stats + Persistence) ══════════════

    console.log('\n\n═══ PHASE 6: BUILD — Milestone 3 ════════════════════════════════════');

    const state7 = getLcState(SESSION_ID);
    check(state7?.currentMilestoneId === 'ms-3', 'T9: auto-advanced to ms-3',
      `got: ${state7?.currentMilestoneId}`);

    const userMsg8 = userTurn('ano');
    const response8 = await handleLifecycleInput(userMsg8, context);
    systemTurn('BUILD ms-3 result', response8);

    const ms3Db = msRepo.getMilestone('ms-3');
    check(ms3Db?.status === 'PASSED', 'T10: ms-3 PASSED in DB', `got: ${ms3Db?.status}`);

    check(fs.existsSync(path.join(projectPath, 'lib/screens/stats.dart')), 'T10: stats.dart exists');
    check(fs.existsSync(path.join(projectPath, 'lib/services/stats_service.dart')), 'T10: stats_service.dart exists');

    const statsContent = fs.readFileSync(path.join(projectPath, 'lib/services/stats_service.dart'), 'utf8');
    check(statsContent.includes('totalVolumeLast30Days'), 'T10: stats_service has totalVolumeLast30Days');
    check(statsContent.includes('weeklyFrequency'), 'T10: stats_service has weeklyFrequency');

    // ═══ PHASE 7: Review acknowledgement → Completion ════════════════════

    const stateAfterMs3 = getLcState(SESSION_ID);
    if (stateAfterMs3?.phase === 'REVIEW') {
      console.log('\n\n═══ PHASE 7: Review → Completion ═════════════════════════════════════');

      const userMsgContinue = userTurn('pokračovat');
      const completionResp = await handleLifecycleInput(userMsgContinue, context);
      systemTurn('COMPLETED', completionResp);

      check(completionResp?.content?.includes('dokončen') || completionResp?.content?.includes('Completed'),
        'T11: completion response mentions done');
    }

    // ═══ PHASE 8: Verification ═══════════════════════════════════════════

    console.log('\n\n═══ PHASE 8: Final Verification ══════════════════════════════════════');

    const lifecycleId = stateAfterMs3?.lifecycleId || state5?.lifecycleId;

    // DB verification
    console.log('\n  ─── DB Verification ───');
    const lcDb = lifecycleRepo.findById.get(lifecycleId);
    check(lcDb != null, 'DB: lifecycle record exists');
    check(lcDb?.phase === 'COMPLETED', 'DB: lifecycle phase is COMPLETED', `got: ${lcDb?.phase}`);

    const allMs = msRepo.listByLifecycle(lifecycleId);
    check(allMs.length === 3, 'DB: 3 milestones exist', `got: ${allMs.length}`);

    const passedMs = allMs.filter(m => m.status === 'PASSED');
    check(passedMs.length === 3, 'DB: all 3 milestones PASSED', `got: ${passedMs.length}`);

    // File tree verification
    console.log('\n  ─── File Tree ───');
    const expectedFiles = [
      'pubspec.yaml',
      'lib/models/workout.dart',
      'lib/services/database.dart',
      'lib/main.dart',
      'lib/screens/home.dart',
      'lib/screens/workout_detail.dart',
      'lib/widgets/workout_card.dart',
      'lib/screens/stats.dart',
      'lib/services/stats_service.dart',
    ];
    for (const f of expectedFiles) {
      check(fs.existsSync(path.join(projectPath, f)), `File: ${f} exists`);
    }

    // Git verification
    console.log('\n  ─── Git ───');
    try {
      const gitLog = execSync('git log --oneline', { cwd: projectPath, encoding: 'utf8' });
      const commits = gitLog.trim().split('\n');
      check(commits.length >= 4, 'Git: at least 4 commits (init + 3 milestones)', `got: ${commits.length}`);
    } catch (e) {
      check(false, 'Git: log available', e.message);
    }

    // Progress verification
    console.log('\n  ─── Progress ───');
    try {
      const progress = computeLifecycleProgress(lifecycleId);
      check(progress.percentage >= 90, 'Progress: ≥90%', `got: ${progress.percentage}%`);
      const table = formatMilestoneTable(allMs);
      check(table.includes('PASSED'), 'Progress: milestone table shows PASSED');
    } catch (e) {
      check(false, 'Progress: computed', e.message);
    }

    // Cleanup
    if (process.env.KEEP_PROJECT || failed > 0) {
      console.log(`\n  📁 Project preserved at: ${projectPath}`);
    } else {
      try { fs.rmSync(projectPath, { recursive: true, force: true }); } catch { /* ignore */ }
      console.log(`  🧹 Cleaned up (KEEP_PROJECT=1 to preserve)`);
    }

  } catch (err) {
    console.error(`\n💥 FATAL: ${err.message}`);
    console.error(err.stack);
    failed++;
    failures.push({ name: 'FATAL', detail: err.message });
  }

  // ═══ Summary ════════════════════════════════════════════════════════════

  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log(`  Android App E2E: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log(`\n  FAILURES:`);
    for (const f of failures) console.log(`    ❌ ${f.name}: ${f.detail}`);
  }
  console.log('══════════════════════════════════════════════════════════════════════\n');
  process.exit(failed > 0 ? 1 : 0);
}

runTest();
