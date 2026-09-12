@echo off
cd /d "%~dp0"
python start_manager.py
if errorlevel 1 py start_manager.py
