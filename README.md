# Apuestas Carrera Oficina

Web estatica para gestionar apuestas de una carrera en oficina, pensada para publicar en GitHub Pages.
Incluye persistencia remota opcional con Firebase Realtime Database para que los datos no se pierdan entre dias ni entre dispositivos.

## Funcionalidades

- Seleccion de usuario al entrar en la pagina.
- Apuesta por orden usando drag and drop (izquierda ultimo, derecha primero).
- Clave por usuario para poder guardar apuesta.
- Panel admin para introducir resultado real y evaluar.
- Tabla resumen con apuesta y puntuacion (null si no se ha evaluado).

## Datos configurados

Participantes:

- Albert
- Aniol
- Marc
- Roger
- Pere
- Gerard
- Yaiza

Votantes extra (no corren, pero pueden apostar):

- Jose
- Luis
- Cesar
- Flor

Token admin:

- `kento`

Les claus dels usuaris ja no estan al frontend en text pla. Es validen per hash SHA-256.

## Como publicar en GitHub Pages

1. Crea un repositorio nuevo en GitHub (por ejemplo `apuestas-carrera`).
2. En terminal, dentro de esta carpeta, ejecuta:
   - `git init`
   - `git add .`
   - `git commit -m "Primera version apuestas carrera"`
   - `git branch -M main`
   - `git remote add origin https://github.com/TU_USUARIO/TU_REPO.git`
   - `git push -u origin main`
3. En el repositorio, entra en `Settings` -> `Pages`.
4. En `Source`, elige `Deploy from a branch`.
5. Selecciona la rama `main` y la carpeta `/ (root)`.
6. Guarda y espera 1-2 minutos.
7. Abre la URL que te da GitHub Pages.

## Persistencia remota (Firebase)

Si no configuras esto, la app guarda solo en el navegador local (`localStorage`).
Con Firebase, las apuestas quedan compartidas y persistentes.

### 1) Crear base de datos

1. Ve a [Firebase Console](https://console.firebase.google.com/).
2. Crea un proyecto (sin necesidad de Analytics).
3. Abre `Build` -> `Realtime Database`.
4. Crea la base en modo prueba.
5. Copia la URL de base de datos, por ejemplo:
   - `https://mi-carrera-default-rtdb.europe-west1.firebasedatabase.app`

### 2) Configurar la app

1. Abre `config.js`.
2. Rellena:
   - `remoteDbUrl: "https://TU-URL-DE-FIREBASE"`
3. Guarda cambios y vuelve a subir a GitHub (`git add .`, `git commit`, `git push`).

### 3) Pujar hashes de claus a Firebase

Executa des d'aquesta carpeta:

- PowerShell:
  - `$env:REMOTE_DB_URL="https://TU-URL-RTDB"` (opcional)
  - `node .\scripts\seed-password-hashes.mjs`

Aixo crea/actualitza `/passwordHashes` a la base de dades.

### 4) Reglas recomendadas para esta prueba

En `Realtime Database` -> `Rules`, para una prueba interna simple:

```json
{
  "rules": {
    ".read": true,
    ".write": true
  }
}
```

Nota: esto es abierto y solo recomendable para uso interno temporal.
