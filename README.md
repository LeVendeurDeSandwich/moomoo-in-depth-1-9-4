# MooMoo in Depth
A collection of lots of information about MooMoo.io, how it works, what happens and why it happens.

This is a project that aims to explain what is actually behind the client source code of MooMoo.io.

It's not just about the client, but also about vulnerabillities and other stuff, how it works and why.

> **Updated for build 1.9.4** (`index-6642cae8.js`, API 1.31). The game changed a lot since the first
> version of these docs: minified names are different, packet ids were reassigned, the canvases are
> WebGL, and the connection is authenticated. The table below says which pages are current.

| Section | Status |
|---|---|
| [Rendering](rendering/) and [canvas](rendering/canvas/) | **rewritten** for 1.9.4 |
| [Gameplay packets](protocol/current/) | **new**: ids of 1.9.4 and a field-by-field reference (checked against a reference server) |
| [Protocol overview](protocol/) | structure still valid, ids and counts updated |
| [Outgoing (legacy)](protocol/client/) / [Incoming (legacy)](protocol/server/) | legacy ids, kept as history |
| [Vultr](vultr/) | legacy, with a short note on how the server list works now |
| [Userscripts](userscript/) | readable-bundle tool added |
| [ws handler](protocol/ws%20handler/) | legacy, **not updated** |
| [Vulnerabilities](vulnerabilities/) | **not updated**: these pages describe old client-side bugs and were left as they were |

## Table of contents:

- [Protocol](protocol/)
  - [current gameplay packets (1.9.4)](protocol/current/)
  - [server-side (legacy)](protocol/server/)
  - [client-side (legacy)](protocol/client/)
  - [ws-handler (legacy)](protocol/ws%20handler/io-client.md)
    - [example scripts](protocol/ws%20handler/example-scripts)
- [Rendering](rendering/)
  - [canvas](rendering/canvas/)
- [Userscripts](userscript/)
  - [readable bundle](userscript/README.md#readable-bundle)
- [Vulnerabilities](vulnerabilities/)
  - [force-connect](vulnerabilities/force-connect)
  - [upgradebar-issues](vulnerabilities/upgradebar-issues)
- [Vultr](vultr/)
  - [io-client](vultr/io_client.md)

# Contributors

<a href="https://github.com/NuroC/moomoo-in-depth/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=NuroC/moomoo-in-depth" />
</a>
