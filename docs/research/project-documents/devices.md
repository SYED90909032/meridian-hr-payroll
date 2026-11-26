# Meridian attendance-device integration note

*Research date: 24 November 2026. “Unverified” means that the claim could not be confirmed in a public vendor manual or developer portal.*

## 1. ZKTeco: ADMS, SDKs and BioTime

ZKTeco’s ADMS or “push” family is an HTTP protocol in which the terminal initiates the connection to a server. A representative implementation documents `GET/POST /iclock/cdata` for registration, heartbeat and attendance data, `GET /iclock/getrequest` for device polling of queued commands, and `POST /iclock/devicecmd` for command results. Attendance is commonly sent as tab-separated `ATTLOG` rows containing employee number, device time, verification mode, in/out status and work code. [1] [2] The device makes an outbound request to the HR vendor’s endpoint, which suits sites behind NAT or a firewall.

The practical flow is: configure the terminal’s ADMS/cloud server address; receive the device’s serial-number registration; answer the heartbeat/configuration request; accept and durably queue `ATTLOG`; acknowledge only after the payload is safely stored; and later replay or transform the record into Meridian’s attendance API. Adapter tests must be per model because fields and command verbs vary by firmware. [1] [2]

ZKTeco’s public SDK page exposes downloads such as ZKFinger SDK for Linux, Windows and Android and ZKBioModuleSDK, which are local/device-side SDK assets rather than evidence of a cloud webhook. [3] The public ZKBio Time API page confirms a third-party connection surface, but its page does not publish endpoint semantics; obtain the licensed API manual and version-specific authentication details from ZKTeco before committing. [4] A standalone SDK generally requires a LAN bridge, whereas PUSH/ADMS lets the device call an internet endpoint.

Do not treat a serial number as a secret. In many ADMS implementations the serial number is visible in the request and used for device identification. If serial number is the only proof of identity, anyone who learns it can forge punches. Plain HTTP examples and public implementations exist, while ZKTeco’s current public pages do not establish that every model enforces HTTPS or mutual authentication. [1] [2] [3] Kaspersky’s research on a ZKTeco terminal also found serious device-side issues, including protocol-authentication weaknesses and multiple CVEs, demonstrating why the terminal and its LAN should be treated as hostile IoT infrastructure. [5]

Mitigations are: use HTTPS at a reverse proxy where the firmware supports it; isolate terminals in a VLAN; allow-list only the bridge or ingress IPs; rotate per-device credentials or HMAC secrets where firmware permits; bind a device record to serial number plus enrollment secret, expected site and certificate/fingerprint; rate-limit and replay-check requests; reject unknown serials; and log raw payload hashes for forensic review. If a legacy device can only send HTTP or serial-number-authenticated requests, put it behind a site bridge that validates the LAN source and signs the normalized event before forwarding it. Never expose the device’s management UI or port 4370 directly to the Internet.

## 2. Other hardware vendors and integration surfaces

**eSSL India.** eSSL’s eBioServer-New is explicitly middleware between biometric devices and payroll, HRMS and ERP applications. Its page says devices push data to a centralized server, and it offers API retrieval of punch records, database export to MS SQL/MySQL/Oracle and a Webhook feature. The published API list includes device logs, employee punch logs, device commands and enrollment operations. [6] This is a cloud-push-capable product only when the customer hosts or buys the eBioServer service; the public material does not prove that every eSSL terminal can push directly to a third-party SaaS without eBioServer. eTimeTrackLite and exact webhook authentication are unverified here.

**Hikvision.** ISAPI is a REST-style HTTP protocol for device/server communication, using URI plus GET, POST, PUT and DELETE; Hikvision’s integration guide also describes ISUP/EHome for dynamic-IP devices and a DeviceGateway that converts device traffic to RESTful APIs. [7] HikCentral Professional OpenAPI is a separate REST integration surface: a partner enables OpenAPI, creates an app key/secret, authorizes APIs, searches access records and subscribes to event types, including access-control events. [7] [8] Expect local HikCentral/OpenAPI or gateway integration; direct Hik-Connect attendance webhooks are unverified.

**Suprema.** BioStar X API is a JSON REST API for devices, terminals, users and biometrics, and its “Anywhere” description connects to a local BioStar X server remotely using cloud technology. [9] The older BioStar Device SDK is a Windows C++/C# local SDK. [10] Suprema G-SDK is listed in the same developer-tools family, but the public page reviewed did not expose enough detail to classify it as a general-purpose attendance webhook; treat it as SDK/server integration until the product-specific manual confirms otherwise. Expect a BioStar server or connector, not direct cloud push.

**Dahua.** Dahua advertises HTTP Push: selected alarm events, reports and images are sent to a third-party HTTP service, with HTTPS and authentication listed as security features. [11] Dahua’s DSS professional software also advertises API/SDK capabilities. [12] This supports event push where exposed, but attendance schemas must be verified per product line. Direct cloud attendance webhook support is otherwise unverified.

**Anviz.** CrossChex Cloud is a cloud attendance service with direct real-time transfer from biometric/RFID terminals and an Anviz safety-control protocol. [13] Anviz’s developer community says CrossChex Cloud provides both a REST-like Cloud API to retrieve records and webhooks that push attendance to a customer web server; it also points developers to the Cloud API console. [14] This is one of the clearest vendor-supported cloud-push/webhook options. Confirm payload signing, retry semantics and rate limits before production.

**Matrix COSEC.** Matrix documents three third-party integration choices: database-to-database, API pull/push and customized export templates. It supports MS SQL and Oracle and mentions other database transfer options. [15] Matrix also sells cloud-based COSEC Vyom and server-based COSEC Centra, but the public integration article does not establish a generic direct-to-Meridian webhook from every terminal. Treat COSEC as API/database/server-connector first; cloud push is unverified.

## 3. What HR SaaS integrations reveal

Keka documents all four patterns: SQL, SDK, Push and API. Its SQL/SDK/push prerequisites require devices on the customer LAN and a powered Windows “Keka Sync tool” PC with outbound access to Keka; its push setup asks for serial number and IP address and instructs the device to use `a.keka.com` as the server address. [16] Keka also exposes a separate attendance-log ingestion API: a vendor posts batches to an assigned regional URL with an `X-API-Key`, a Keka-issued `DeviceIdentifier`, employee attendance number, timestamp and status. It accepts up to 1,000 logs and 30 days of backfill. [17]

Zoho People documents a similar split. Its biometric integration supports an API method and a plugin method. The API method lets the biometric vendor or customer IT push attendance directly to Zoho’s bulk-import endpoint, with OAuth and a stated threshold of ten requests per minute plus a five-minute lock period. The plugin method runs through a Tomcat server and database queries. [18] [19] The dominant SaaS pattern is direct outbound push/API when available, otherwise an on-prem agent reads SQL or a local SDK and forwards normalized punches. Direct SaaS-to-device inbound connections require static IPs, VPNs or port forwarding.

## 4. Mobile attendance anti-spoofing and privacy

For Android, Play Integrity can bind a sensitive action to the genuine Play-installed app and a certified device, with app, device, licensing, malware, overlay and recent-activity verdicts. Google explicitly says to combine it with other anti-abuse signals, protect requests with a request hash or nonce, and avoid caching verdicts. [20] Meridian should request an integrity verdict at check-in, bind the hash to employee, timestamp, site, nonce and client event ID, and score rather than automatically reject every low-trust device.

Android exposes `Location.isMock()` for locations marked as mock/faked, but Android cautions that mock locations can be legitimate and should be rejected only where essential. [21] Use it as one signal with accuracy, elapsed-realtime age, speed, developer-mode/root signals where lawful, IP/ASN anomalies, geofence dwell time and Wi-Fi/BLE beacon evidence. Geofences are not proof of presence: GPS can be spoofed, and Wi-Fi/BLE IDs can be cloned. A signed rotating QR displayed at a site kiosk, or a short-range NFC tap, adds a site-held factor.

iOS DeviceCheck provides privacy-preserving per-device state, while App Attest lets the server verify that sensitive requests came from a legitimate app instance using a device-generated cryptographic key. Apple also warns that no single policy eliminates all fraud. [22] Use App Attest for mobile punch requests and keep the server as the decision-maker.

ML Kit Face Detection is on-device and real-time, but it detects faces and landmarks rather than recognizing people or proving liveness. [23] A true selfie attendance flow needs a liveness-capable SDK or challenge. AWS Rekognition Face Liveness uses a short video selfie, returns a probabilistic 0–100 confidence score, a reference image and audit images, and recommends combining thresholds with other controls such as geolocation; it is cloud processing, so assess transfer, retention and cost. [24] FaceTec is a commercial alternative billed per 3D liveness check or per user with a monthly minimum, and requires customers to run its software on their servers. [25] Check current regional pricing at procurement time. Where possible, store a device-bound template or an irreversible derived credential rather than raw face/fingerprint images in Meridian’s cloud, and provide a non-biometric fallback.

GDPR Article 9 treats biometric data used to uniquely identify a person as a special category, requiring a permitted exception and safeguards. [26] Illinois BIPA defines fingerprints and hand/face geometry as biometric identifiers and requires notice, purpose/term disclosure, written release, a public retention/destruction policy and reasonable protection; it also creates a private right of action. [27] India’s DPDP Act defines personal data broadly, requires lawful purpose/notice/consent or a legitimate use, reasonable safeguards, breach handling and erasure when the purpose ends; the employment-related legitimate-use provision may be relevant, but the biometric-specific implementation and rules must be checked with counsel. [28] Minimize collection, document purpose and retention, encrypt templates, separate identity mapping from biometric material, and complete a DPIA or local equivalent before rollout.

## 5. Kiosks, QR and NFC

A shared tablet should be enrolled as a managed dedicated device and placed in Android lock-task mode. Android’s official guidance says only device-policy-controller-allow-listed apps run, notifications/home/other apps can be blocked, and overlays can be restricted. [29]

A rotating QR should contain only a short-lived random site challenge, not names or employee IDs. The employee scans it with a registered phone, and Meridian verifies challenge freshness, device/app attestation, geofence/beacon evidence and one-use nonce. NFC cards/tags are convenient but clonable; use them as an identifier plus server nonce or combine with PIN/selfie for higher-risk sites. Provide fallbacks for accessibility, lost phones and outages.

## 6. Recommended Meridian architecture

Build a small open-source edge bridge in Go. A statically linked Go binary is easy to deploy on Windows, Linux or a small ARM box, has a strong HTTP/TLS standard library, low operational footprint and straightforward concurrency for device polling and queues. Rust is a reasonable higher-assurance alternative; Python is faster for prototyping but less convenient as a single cross-platform service.

Define an adapter interface with `discover`, `read_events`, `ack`, `set_time`, `sync_users` and `health`. Implement ZKTeco ADMS receiver first, then ZKTeco SDK/BioTime pull, eSSL eBioServer/API, Hikvision ISAPI/OpenAPI, Suprema BioStar, Dahua HTTP Push, Anviz webhook/API and Matrix API/database. Adapters emit one canonical punch: tenant, site, source device, vendor event ID or deterministic hash, employee external ID, event time, received time, timezone/offset, direction/status, verification method, source confidence and raw-payload hash.

Persist the raw event and a normalized event in a local encrypted SQLite queue. Sign each normalized record with an edge key, include a monotonic sequence and an event UUID, and use mutual TLS or HTTPS plus per-tenant API keys to Meridian. Acknowledge a device only after durable local write; retry cloud delivery with exponential backoff and jitter; retain the queue through planned outages; and expose health, lag, queue depth and last-device-seen metrics.

Make ingestion idempotent on `(tenant, source_device, vendor_event_id)` where available, otherwise on a canonical hash of device, employee, event time, status and vendor sequence. Meridian’s API should return an explicit accepted/duplicate/rejected result. Preserve late and duplicate events for audit but do not double-count payroll. Compare device time with NTP/server time, record offset and drift, flag implausible jumps, and avoid silently rewriting historical timestamps.

## References

[1]: https://github.com/s0x90/zkteco-adms "ZKTeco ADMS Go implementation and protocol reference"
[2]: https://easytimehr.com/docs/developer-adms "ZKTeco ADMS Push Protocol"
[3]: https://www.zkteco.com/en/SDK "ZKTeco SDK download center"
[4]: https://www.zkteco.com/en/ZKBioTime_API "ZKBio Time API"
[5]: https://securelist.com/biometric-terminal-vulnerabilities/112800/ "Kaspersky QR code SQL injection and biometric terminal vulnerabilities"
[6]: https://esslsecurity.com/eSSL-eBioserver-New "eSSL eBioServer New"
[7]: https://www.hikvision.com/content/dam/hikvision/vn/webinar/Thang3_Hikvision_Tich_Hop_He_Thong_Overview-of-3rd-Party-Integration.pdf "Hikvision Overview of Third Party Integration"
[8]: https://enpinfo.hikvision.com/hkwsen/unzip/20260723200832_95640_doc/index.html "HikCentral Professional OpenAPI Developer Guide"
[9]: https://www.supremainc.com/en/support/development-tools_biostar-2-api.asp "Suprema BioStar X API"
[10]: https://www.supremainc.com/en/support/development-tools_biostar-2-sdk.asp "Suprema BioStar Device SDK"
[11]: https://www.dahuasecurity.com/in/products/key-technologies/5e/dahua-http-push "Dahua HTTP Push"
[12]: https://software.dahuasecurity.com/en/dss/professional "Dahua DSS Professional"
[13]: https://www.anviz.com/crosschex-cloud-20200821.html "Anviz CrossChex Cloud"
[14]: https://community.anviz.com/t/crosschex-cloud-api-definition/1139 "CrossChex Cloud API definition"
[15]: https://www.matrixcomsec.com/cosec-time-attendance-integration-with-third-party-software/ "COSEC Time Attendance Integration with Third Party Software"
[16]: https://help.keka.com/hc/en-us/articles/39946719141265-Prerequisites-for-different-Biometric-Integration-Methods "Keka prerequisites for biometric integration methods"
[17]: https://help.keka.com/hc/en-us/articles/39946756738577-API-Guide-for-Attendance-Log-Ingestion "Keka API Guide for Attendance Log Ingestion"
[18]: https://help.zoho.com/portal/en/kb/people/administrator-guide/attendance-management/biometric-device-integration/articles/biometric-device-integration-overview "Zoho People biometric integration overview"
[19]: https://help.zoho.com/portal/en/kb/people/administrator-guide/attendance-management/biometric-device-integration/articles/api-method "Zoho People biometric API method"
[20]: https://developer.android.com/google/play/integrity/overview "Android Play Integrity API overview"
[21]: https://developer.android.com/reference/android/location/Location "Android Location API reference"
[22]: https://developer.apple.com/documentation/devicecheck "Apple DeviceCheck and App Attest"
[23]: https://developers.google.com/ml-kit/vision/face-detection "Google ML Kit face detection"
[24]: https://docs.aws.amazon.com/rekognition/latest/dg/face-liveness.html "Amazon Rekognition Face Liveness"
[25]: https://www.facetec.com/pricing "FaceTec pricing"
[26]: https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng "EU General Data Protection Regulation"
[27]: https://www.ilga.gov/Legislation/ILCS/Articles?ActID=3004&ChapterID=57&Print=True "Illinois Biometric Information Privacy Act"
[28]: https://www.meity.gov.in/static/uploads/2024/06/2bf1f0e9f04e6fb4f8fef35e82c42aa5.pdf "India Digital Personal Data Protection Act 2023"
[29]: https://developer.android.com/work/dpc/dedicated-devices/lock-task-mode "Android Enterprise lock task mode"
