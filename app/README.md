# BuVoWerk - Google Sheets Integration

## Übersicht

Die App wurde von jsonblob.com auf Google Sheets als Datenquelle umgestellt. Benutzer werden über Einladungslinks mit Google Sheets-Parametern eingeladen.

## Einladungslink Format

```
/invite?d=<spreadsheet_id>&s=<sheet_name>&k=<api_key>
```

**Parameter:**
- `d`: Die Google Sheets Spreadsheet ID (nur die ID, nicht die vollständige URL)
- `s`: Der Name des Tabs/Blatts in der Tabelle  
- `k`: Google Sheets API Key

**Beispiel:**
Für die URL `https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit` würde der Parameter `d` den Wert `1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms` enthalten.

## Google Sheets Setup

### 1. Tabelle vorbereiten

Die Tabelle sollte folgende Struktur haben, beginnend in Zeile 5:

| A | B | C | D | E | F | G | H |
|---|---|---|---|---|---|---|---|
| SuggestedBy | Funfacts | Buchtitel | Autor | Jahr | Seitenzahl | Genres | Kurzbeschreibung |

**Spalten Erklärung:**
- **A (SuggestedBy)**: Name der Person, die das Buch vorgeschlagen hat
- **B (Funfacts)**: Derzeit ignoriert
- **C (Buchtitel)**: Titel des Buchs
- **D (Autor)**: Autor des Buchs
- **E (Jahr)**: Erscheinungsjahr (optional)
- **F (Seitenzahl)**: Anzahl Seiten (optional)
- **G (Genres)**: Genres/Kategorien (optional)
- **H (Kurzbeschreibung)**: Beschreibung des Buchs (optional)

### 2. Google API Key einrichten

1. Gehe zur [Google Cloud Console](https://console.cloud.google.com/)
2. Erstelle ein neues Projekt oder wähle ein bestehendes aus
3. Aktiviere die Google Sheets API
4. Erstelle einen API Key
5. Beschränke den API Key auf die Google Sheets API (empfohlen)

### 3. Tabelle freigeben

Stelle sicher, dass die Google Tabelle öffentlich lesbar ist oder mit dem API Key zugänglich ist.

## Funktionsweise

### Beim Besuch eines Einladungslinks:

1. Die Parameter `d`, `s`, und `k` werden aus der URL extrahiert
2. Diese werden als Cookies gespeichert
3. Der Benutzer wird zur Hauptanwendung weitergeleitet
4. Die Konfiguration wird aus den Cookies geladen
5. **Verfügbare Namen werden aus der Tabelle geladen**
6. **Benutzer wählt seinen Namen aus der Dropdown-Liste**

### Datenoperationen:

**Lesen (✅ Unterstützt):**
- Bücher werden direkt aus Google Sheets geladen
- Refresh-Button lädt die neuesten Daten

**Likes (✅ Unterstützt):**
- Likes werden lokal in Browser-Cookies gespeichert
- Funktioniert pro Browser/Gerät

**Hinzufügen (⚠️ Eingeschränkt):**
- Neue Bücher können nicht automatisch hinzugefügt werden
- Die App zeigt die Buchdetails an und kopiert sie in die Zwischenablage
- Bücher müssen manuell in die Google Tabelle eingetragen werden

**Bearbeiten/Löschen (❌ Nicht verfügbar):**
- Edit-Button wird nicht angezeigt
- Benutzer werden darauf hingewiesen, Änderungen direkt in Google Sheets zu machen

**Namensauswahl (✅ Automatisch):**
- Verfügbare Namen werden automatisch aus der "SuggestedBy" Spalte geladen
- Benutzer wählen aus einem schönen Button-Grid anstatt freie Eingabe
- Nur bereits in der Tabelle vorhandene Namen können ausgewählt werden
- Responsive Design für verschiedene Bildschirmgrößen

## Verwendung

### 1. Einladungslink generieren

Verwende die `invite.html` Datei, um Einladungslinks zu generieren:

```bash
# Öffne invite.html im Browser
open invite.html
```

### 2. Einladungslink teilen

Teile den generierten Link mit den Buchclub-Teilnehmern.

### 3. App verwenden

- Benutzer klicken auf den Einladungslink
- Werden zur Hauptanwendung weitergeleitet
- Können Bücher ansehen und liken
- Neue Buchvorschläge werden als Text angezeigt zum manuellen Eintragen

## Technische Details

### Cookies

Die App speichert folgende Cookies (Gültigkeit: 1 Jahr):
- `sheets_id`: Google Sheets Spreadsheet ID
- `sheets_name`: Name des Tabs
- `api_key`: Google API Key
- `bookclub_username`: Benutzername
- `bookclub_likes`: JSON mit Like-Daten

### API Aufrufe

```javascript
// Daten laden
GET https://sheets.googleapis.com/v4/spreadsheets/{spreadsheetId}/values/{range}?key={apiKey}

// Range Format: "SheetName!A5:H1000"
```

### Datenmapping

```javascript
// Google Sheets Zeile -> Book Objekt
{
  title: row[2],           // Spalte C
  author: row[3],          // Spalte D  
  year: row[4],            // Spalte E
  pages: row[5],           // Spalte F
  genres: row[6],          // Spalte G
  description: row[7],     // Spalte H
  suggestedBy: row[0],     // Spalte A
  likes: []                // Aus lokalem Cookie
}
```

## Fehlerbehandlung

- Fehlende Konfiguration wird dem Benutzer angezeigt
- API-Fehler werden abgefangen und gemeldet
- Refresh-Button ermöglicht erneutes Laden bei Problemen

## Limitierungen

1. **Schreibzugriff**: Automatisches Hinzufügen/Bearbeiten erfordert OAuth2
2. **Likes-Synchronisation**: Likes sind pro Browser/Gerät lokal
3. **Echtzeit-Updates**: Keine automatische Synchronisation, manueller Refresh nötig

## Migration von jsonblob

Bestehende jsonblob-Daten können durch manuelles Übertragen in Google Sheets migriert werden:

1. Exportiere die Daten aus jsonblob
2. Übertrage sie in das Google Sheets Format
3. Verwende die neue Einladungslink-Funktionalität
