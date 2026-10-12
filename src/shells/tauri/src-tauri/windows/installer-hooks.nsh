; Hooks into Tauri's NSIS installer (bundle.windows.nsis.installerHooks in tauri.conf.json).
;
; Genbeya Tauri was called GitDesk Tauri before 0.5. NSIS installations are keyed by product
; name, so the new installer would install next to the old app instead of replacing it. Before
; it installs, it removes GitDesk Tauri silently with GitDesk's own uninstaller, which keeps the
; app's data (only its uninstall dialog offers to delete that) for Genbeya to take over, and
; removes its shortcuts and its claim on gitdesk:// links, which Genbeya Tauri registers again.
; The MSI needs no hook: its upgrade code is GitDesk Tauri's (bundle.windows.wix.upgradeCode).

!macro NSIS_HOOK_PREINSTALL
  Push $R0
  Push $R1
  ReadRegStr $R0 SHCTX "Software\Microsoft\Windows\CurrentVersion\Uninstall\GitDesk Tauri" "UninstallString"
  ; Where GitDesk Tauri is installed; its publisher came from its identifier, dev.gitdesk.tauri.
  ReadRegStr $R1 SHCTX "Software\gitdesk\GitDesk Tauri" ""
  ${If} $R1 == ""
  ${AndIf} $R0 != ""
    ; The folder of the uninstaller: "<folder>\uninstall.exe" without the quotes and the file name.
    StrCpy $R1 $R0 "" 1
    StrCpy $R1 $R1 -15
  ${EndIf}
  ${If} $R0 != ""
  ${AndIf} $R1 != ""
    ; Run in place (_?=) to wait for it; it cannot delete itself then.
    ExecWait '$R0 /S _?=$R1'
    Delete "$R1\uninstall.exe"
    RMDir "$R1"
    DeleteRegKey SHCTX "Software\gitdesk\GitDesk Tauri"
    DeleteRegKey /ifempty SHCTX "Software\gitdesk"
  ${EndIf}
  Pop $R1
  Pop $R0
!macroend
