# Get - Extract - Distribute

a microservice tool for downloading, unpacking and distribution of files from a page by filtering all links on page using defined rules.

## Stack

- Bun 1.4 with native functionality, no external dependencies whenever possible
- OOP where possible
- Test suite with maximum code coverage
- NPM scripts for dev,build,start,test of the application
- Dockerfile for building the image following standard security guidelines
- docker-compose.yml file for creating container from the image
- Github Workflow for linting on commit and image building on merge to main branch.

## Input

On an HTTP endpoint an URL is expected.
Rules for incoming URL should validate the URL for further processing.
The URL should be a text page with multiple links to files.
Code should be Object-Oriented, so an abstract class with virtual functionality and specific class for a particular variant.
In the first phase, two variants will be supported: GitHub release page for downloading assets and peeplink page for downloading archive files.

## Flow

1. once an URL is validated by variant's URL validation rules, it will be downloaded and all links to files will be collected to an array of links.
2. Each item in the array will be validated by variant's download rules. If a link passes any rule it will be added to an array of links for download
3. If a link passes any download validation, it will be downloaded to temporary location (tmp subfolder). The name of the downloaded file will be later accessible as {DOWNLOADED}
4. Each downloaded file will be checked against variant's unpack rules.
5. If a file passes any unpack rule, it will be extracted to a smart subfolder (if there are files in root of the archive, extract to a subfolder named as the archive, if there are only folders in root of the archive, extract the folder to root of temporary location). The path of the extraction will be later accessible as {UNPACKED}
6. After each extraction, unpack rules are re-checked within the extracted folder only.
7. Each downloaded and/or extracted file will be checked against variant's copy rules.
8. If a file passes any copy rule, it will be copied to destination.
9. Finally, the downloaded and/or extracted file in temporary location will be deleted.
10. If env.variable DRY_RUN (or url parameter dry_run) is set to TRUE, no real action will be executed, just the url will be downloaded and parsed for files, and logged to console the filters/actions on these files

## Output

Every step will be logged into a log file (/log subfolder), with configurable rotation.
Information will be displayed to the console, based on the LOG_LEVEL environment variable (default "info")

## Rules

Rules are regular expressions, named capture groups will be later accessible as {<capture_group_name>}
Copy rules consist of two parts, separated by ':'

- Rule to match the source file(s)/folder(s)
- Target path where to copy the source file(s)/folder(s)

### URL validation

```yml
variants:
  github:
    url: '^https://github.com/(?<ORG>.+)/(?<REPO>.+)/releases/tag/(?<TAG>.+)$'
  peeplink:
    url: '^https://peeplink.in/(?<ID>.+)$'
```

### Download validation

```yml
variants:
  github:
    get:
      - '(?<EXE_NAME>\.exe)$'
      - '(?<ZIP_NAME>\.zip)$'
  peeplink:
    get:
      - '^https://rg\.to/.+'
      - '^https://rapidgator\.net/.+'
```

### Unpack validation

```yml
variants:
  github:
    unpack:
      - '^{ZIP_NAME}$'
  peeplink:
    unpack:
      - '^{DOWNLOADED}$'
```

### Copy validation

```yml
variants:
  github:
    copy:
      - '^{EXE_NAME}$:/bin'
      - '^{ZIP_NAME}$:/downloads'
      - '^{UNPACKED}/.+\.exe$:/bin'
  peeplink:
    copy:
      - '^{UNPACKED}$:/releases'
```

### Entire ruleset example

```yml
variants:
  github:
    url: '^https://github.com/(?<ORG>.+)/(?<REPO>.+)/releases/tag/(?<TAG>.+)$'
    get:
      - '(?<EXE_NAME>\.exe)$'
      - '(?<ZIP_NAME>\.zip)$'
    unpack:
      - '^{ZIP_NAME}$'
    copy:
      - '^{EXE_NAME}$:/bin'
      - '^{ZIP_NAME}$:/downloads'
      - '^{UNPACKED}/.+\.exe$:/bin'
  peeplink:
    url: '^https://peeplink.in/(?<ID>.+)$'
    get:
      - '^https://rg\.to/.+'
      - '^https://rapidgator\.net/.+'
    unpack:
      - '\.zip$'
      - '\.rar$'
    copy:
      - '^{UNPACKED}$:/releases'
```
