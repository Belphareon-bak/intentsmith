@echo off
REM C3 IDE - Tailwind CSS Setup Script (Windows)
REM Automatická instalace Tailwind CSS + dependencies

echo.
echo 🎨 C3 IDE - Tailwind CSS Setup
echo ================================
echo.

REM Check if package.json exists
if not exist "package.json" (
  echo ❌ Error: package.json not found!
  echo    Please run this script from the c3-ide root directory.
  pause
  exit /b 1
)

echo 📦 Installing Tailwind CSS dependencies...
echo.

REM Try yarn first, then npm
where yarn >nul 2>nul
if %ERRORLEVEL% EQU 0 (
  echo Using yarn...
  call yarn add -D tailwindcss postcss autoprefixer @tailwindcss/typography clsx tailwind-merge
) else (
  where npm >nul 2>nul
  if %ERRORLEVEL% EQU 0 (
    echo Using npm...
    call npm install -D tailwindcss postcss autoprefixer @tailwindcss/typography clsx tailwind-merge
  ) else (
    echo ❌ Error: Neither npm nor yarn found!
    echo    Please install Node.js first.
    pause
    exit /b 1
  )
)

echo.
echo ✅ Dependencies installed successfully!
echo.
echo 📝 Next steps:
echo    1. Read INTEGRATION-GUIDE.md for integration instructions
echo    2. Build the project: yarn build (or npm run build)
echo    3. Start C3 IDE: yarn start (or npm start)
echo.
echo 📚 Documentation:
echo    - INTEGRATION-GUIDE.md - Integration overview
echo    - INTEGRATION-GUIDE.md - Detailed integration
echo    - VISUAL-PREVIEW.md - Design preview
echo    - START.md - Development guide
echo.
echo 🚀 Happy coding!
echo.
pause
