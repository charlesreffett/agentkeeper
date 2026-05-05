---
name: Development team
description: ""
roles:
  - id: developer
    count: 3
  - id: po
    count: 2
  - tester
  - reviewer
  - pm
flows:
  - - pm
    - po
  - - developer
    - tester
  - - developer
    - reviewer
  - - developer
    - po
  - - po
    - developer
  - - reviewer
    - developer
  - - tester
    - developer
entryPoints:
  - pm
  - po
---

Agency to get things done
