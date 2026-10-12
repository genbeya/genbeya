; Included in electron-builder's NSIS installer (build/installer.nsh is its default include).
;
; Genbeya was called GitDesk before 0.5. The installer keeps GitDesk's GUID (nsis.guid in
; package.json, derived from GitDesk's appId), so it finds an installed GitDesk, removes it as an
; older version and takes over its registry entries. It would install into GitDesk's folder
; again, though: the folder of a previous installation wins. A folder named GitDesk becomes
; Genbeya next to it; one the user chose under another name stays.

!include FileFunc.nsh

!macro customInit
  ${GetFileName} $INSTDIR $R0
  ${If} $R0 == "GitDesk"
    ${GetParent} $INSTDIR $R0
    StrCpy $INSTDIR "$R0\${APP_FILENAME}"
  ${EndIf}
!macroend
