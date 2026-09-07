@echo off
chcp 65001 >nul
title Sistema OS - Gerador de Instalador

echo.
echo ================================================
echo    SISTEMA OS - GERADOR DE INSTALADOR
echo    Assistencia Tecnica e Gestao
echo ================================================
echo.

cd /d "%~dp0"

echo [1/4] Verificando Node.js...
node --version >nul 2>&1
if errorlevel 1 (
    echo.
    echo ERRO: Node.js nao encontrado!
    echo Instale em: https://nodejs.org
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do echo    OK - Node.js %%v encontrado.

echo.
echo [2/4] Verificando dependencias...
if not exist "node_modules\" (
    echo    Instalando dependencias pela primeira vez...
    echo    Aguarde, pode levar alguns minutos...
    echo.
    call npm install
    if errorlevel 1 (
        echo.
        echo ERRO ao instalar dependencias!
        pause
        exit /b 1
    )
    echo    OK - Dependencias instaladas.
) else (
    echo    OK - Dependencias ja instaladas.
)

echo.
echo [3/4] Limpando versao anterior...
if exist "dist\" (
    rmdir /s /q "dist\"
    echo    OK - Pasta dist limpa.
) else (
    echo    OK - Nada para limpar.
)

echo.
echo [4/4] Gerando instalador .exe...
echo    Aguarde de 1 a 3 minutos...
echo.

call npm run build:win
if errorlevel 1 (
    echo.
    echo ERRO ao gerar o instalador!
    pause
    exit /b 1
)

echo.
echo ================================================
echo    CONCLUIDO! Instalador gerado em dist\
echo ================================================
echo.

echo Deseja abrir a pasta dist com o instalador?
choice /c SN /m "(S=Sim / N=Nao)"
if errorlevel 2 goto fim
if errorlevel 1 explorer "dist\"

:fim
echo.
pause
