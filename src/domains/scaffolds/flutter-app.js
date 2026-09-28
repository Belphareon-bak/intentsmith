// Flutter Mobile App Scaffold (v90)
// ══════════════════════════════════════════════════════════════════════════════

export const flutterAppScaffold = {
  id: 'flutter-app',
  name: 'Flutter Mobile App',
  description: 'Flutter mobile app with Material Design, navigation, and structured screens',
  tags: ['flutter', 'dart', 'mobile', 'android', 'ios'],
  stack: ['Flutter', 'Dart', 'Material Design'],
  complexity: 'SIMPLE',

  files: [
    {
      path: 'pubspec.yaml',
      type: 'config',
      template: `name: {{PROJECT_NAME}}
description: A Flutter mobile application.
version: 1.0.0

environment:
  sdk: '>=3.2.0 <4.0.0'

dependencies:
  flutter:
    sdk: flutter
  cupertino_icons: ^1.0.6

dev_dependencies:
  flutter_test:
    sdk: flutter
  flutter_lints: ^3.0.0

flutter:
  uses-material-design: true`,
    },
    {
      path: 'lib/main.dart',
      type: 'code',
      template: `import 'package:flutter/material.dart';
import 'screens/home.dart';

void main() {
  runApp(const MyApp());
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: '{{PROJECT_NAME}}',
      theme: ThemeData(
        colorSchemeSeed: Colors.blue,
        useMaterial3: true,
      ),
      home: const HomeScreen(),
    );
  }
}`,
    },
    {
      path: 'lib/screens/home.dart',
      type: 'code',
      template: `import 'package:flutter/material.dart';
import '../widgets/app_bar.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: buildAppBar(context, '{{PROJECT_NAME}}'),
      body: const Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.rocket_launch, size: 64, color: Colors.blue),
            SizedBox(height: 16),
            Text(
              'Welcome',
              style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
            ),
            SizedBox(height: 8),
            Text(
              'Your Flutter app is ready.',
              style: TextStyle(fontSize: 16, color: Colors.grey),
            ),
          ],
        ),
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () {},
        child: const Icon(Icons.add),
      ),
    );
  }
}`,
    },
    {
      path: 'lib/widgets/app_bar.dart',
      type: 'code',
      template: `import 'package:flutter/material.dart';

PreferredSizeWidget buildAppBar(BuildContext context, String title) {
  return AppBar(
    title: Text(title),
    centerTitle: true,
    elevation: 0,
  );
}`,
    },
  ],

  postSetup: [
    'flutter pub get',
    'flutter run',
  ],
};
