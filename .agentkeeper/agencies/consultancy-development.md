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
    - null
    - null
  - - developer
    - tester
    - null
    - null
  - - developer
    - reviewer
    - null
    - null
  - - developer
    - po
    - null
    - null
  - - reviewer
    - developer
    - null
    - null
  - - tester
    - developer
    - null
    - null
  - - po
    - developer
    - left
    - right
entryPoints:
  - pm
  - po
layout:
  pm:
    x: 28.250796705977336
    y: 138.19660112501055
  po:
    x: 557.6368744418126
    y: 81.74728571616993
  reviewer:
    x: 176.1708033849676
    y: 390.81207484897703
---

Agency to get things done
