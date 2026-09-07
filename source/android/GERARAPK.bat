@echo off
setlocal EnableExtensions
title Sistema OS - Gerar APK Android

rem Executa sempre a partir da pasta onde este arquivo foi salvo.
cd /d "%~dp0"

echo.
echo ============================================================
echo   Sistema OS - Geracao do APK Android
echo ============================================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo ERRO: Node.js nao foi encontrado.
  echo Instale a versao LTS em https://nodejs.org e execute este arquivo novamente.
  goto :erro
)

where npm >nul 2>&1
if errorlevel 1 (
  echo ERRO: npm nao foi encontrado. Reinstale o Node.js, versao LTS.
  goto :erro
)

if not exist "package.json" (
  echo ERRO: package.json nao foi encontrado nesta pasta.
  echo Salve este arquivo na raiz do projeto Capacitor.
  goto :erro
)

if not exist "capacitor.config.json" (
  echo ERRO: capacitor.config.json nao foi encontrado.
  goto :erro
)

if not exist "www\index.html" (
  echo ERRO: www\index.html nao foi encontrado.
  goto :erro
)

if exist "node_modules\@capacitor\cli" goto :dependencias_prontas
echo Instalando as dependencias do projeto...
call npm install
if errorlevel 1 goto :erro

:dependencias_prontas
echo Dependencias do Node.js ja estao disponiveis.

if exist "android" goto :android_pronto
echo.
echo Criando a plataforma Android pela primeira vez...
call npx cap add android
if errorlevel 1 goto :erro

:android_pronto

echo.
echo Sincronizando os arquivos da pasta www com o projeto Android...
call npx cap sync android
if errorlevel 1 goto :erro

echo.
echo Abrindo o projeto no Android Studio...
call npx cap open android
if errorlevel 1 goto :erro

echo.
echo ============================================================
echo   PROJETO ABERTO NO ANDROID STUDIO
echo ============================================================
echo.
echo Para gerar o APK, use no Android Studio:
echo Build ^> Build Bundle(s) / APK(s) ^> Build APK(s)
echo.
pause
exit /b 0

:erro
echo.
echo ============================================================
echo   NAO FOI POSSIVEL ABRIR O PROJETO
echo ============================================================
echo.
echo Confira a mensagem acima. Android Studio e Android SDK precisam estar
echo instalados e configurados para abrir o projeto.
echo.
pause
exit /b 1
