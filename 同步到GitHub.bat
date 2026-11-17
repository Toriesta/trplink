@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
set PYTHONUTF8=1

echo.
where python >nul 2>nul
if errorlevel 1 (
    echo  [!] 没找到 python，先装 Python 3.10+ 并勾选 Add to PATH
    echo.
    pause
    exit /b 1
)

python "tools\sync_github.py" %*
set RC=%ERRORLEVEL%

echo.
if %RC%==0 (
    echo  [完成] 可以关掉这个窗口了
) else (
    echo  [未完成] 看上面的提示，修好后再双击一次
)
echo.
pause
exit /b %RC%
