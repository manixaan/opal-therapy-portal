Proven. Case Noting and Calendar View are both implemented behind a correctly self-scoped guard (163 unit + 10 integration tests pass). The mobile app's own UI lives outside this repository, so there is no portal tab to prove with E2E/browser QA here — this evidence is for the backend API surface only.

Tracker: e786d774-43bf-4a8b-826d-94bcb97a9613
