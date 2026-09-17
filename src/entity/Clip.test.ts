import { AppDataSource } from "../data-source";
import { Clip, ClipStatus } from "./Clip";
import { Upload } from "./Upload";
import { Location } from "./Location";

const ALL_STATUSES: ClipStatus[] = [
  "queued",
  "rendering",
  "ready",
  "approved",
  "published",
  "rejected",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createTestUpload(): Promise<Upload> {
  const location = await Location.createFromAddress({
    latitude: 41.79907,
    longitude: -87.58413,
    fullAddress: "900 Clip Blvd Chicago IL 60615",
    address: "900 Clip Blvd",
    city: "Chicago",
    state: "IL",
    zip: "60615",
  });

  const upload = new Upload();
  upload.location = location;
  upload.ipAddress = "127.0.0.1";
  upload.filePath = `uploads/test-clip-${Date.now()}-${Math.random()}.mp4`;
  upload.fileHash = `hash-clip-${Date.now()}-${Math.random()}`;
  await upload.save();
  return upload;
}

// ---------------------------------------------------------------------------
// canTransition
// ---------------------------------------------------------------------------

describe("Clip.canTransition", () => {
  const validTransitions: [ClipStatus, ClipStatus][] = [
    ["queued", "rendering"],
    ["rendering", "ready"],
    ["rendering", "rejected"],
    ["ready", "approved"],
    ["ready", "rejected"],
    ["approved", "published"],
    ["approved", "rejected"],
    ["published", "rejected"],
    ["rejected", "queued"],
  ];

  it.each(validTransitions)("%s → %s is valid", (from, to) => {
    expect(Clip.canTransition(from, to)).toBe(true);
  });

  it("returns false for self-transitions", () => {
    for (const status of ALL_STATUSES) {
      expect(Clip.canTransition(status, status)).toBe(false);
    }
  });

  it("returns false for reverse transitions not in the valid set", () => {
    // queued←rendering
    expect(Clip.canTransition("rendering", "queued")).toBe(false);
    // ready←rendering is valid, but ready←queued is not
    expect(Clip.canTransition("queued", "ready")).toBe(false);
    expect(Clip.canTransition("queued", "approved")).toBe(false);
    expect(Clip.canTransition("queued", "published")).toBe(false);
    expect(Clip.canTransition("queued", "rejected")).toBe(false);
    // rendering→published
    expect(Clip.canTransition("rendering", "published")).toBe(false);
    expect(Clip.canTransition("rendering", "approved")).toBe(false);
    // ready→published
    expect(Clip.canTransition("ready", "published")).toBe(false);
    expect(Clip.canTransition("ready", "rendering")).toBe(false);
    expect(Clip.canTransition("ready", "queued")).toBe(false);
    // approved→queued
    expect(Clip.canTransition("approved", "queued")).toBe(false);
    expect(Clip.canTransition("approved", "rendering")).toBe(false);
    expect(Clip.canTransition("approved", "ready")).toBe(false);
    // published→anything but rejected
    expect(Clip.canTransition("published", "queued")).toBe(false);
    expect(Clip.canTransition("published", "rendering")).toBe(false);
    expect(Clip.canTransition("published", "ready")).toBe(false);
    expect(Clip.canTransition("published", "approved")).toBe(false);
    // rejected→anything but queued
    expect(Clip.canTransition("rejected", "rendering")).toBe(false);
    expect(Clip.canTransition("rejected", "ready")).toBe(false);
    expect(Clip.canTransition("rejected", "approved")).toBe(false);
    expect(Clip.canTransition("rejected", "published")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Entity metadata
// ---------------------------------------------------------------------------

describe("Clip entity metadata", () => {
  it("maps to the clips table", () => {
    const metadata = AppDataSource.getMetadata(Clip);
    expect(metadata.tableName).toBe("clips");
  });

  it("exposes the expected column names", () => {
    const metadata = AppDataSource.getMetadata(Clip);
    const columnNames = metadata.columns.map((c) => c.propertyName);

    expect(columnNames).toContain("id");
    expect(columnNames).toContain("createdAt");
    expect(columnNames).toContain("updatedAt");
    expect(columnNames).toContain("status");
    expect(columnNames).toContain("failureReason");
    expect(columnNames).toContain("outputPaths");
    expect(columnNames).toContain("kit");
    expect(columnNames).toContain("publishLog");
    expect(columnNames).toContain("approvedBy");
    expect(columnNames).toContain("approvedAt");
  });

  it("status defaults to queued in the column metadata", () => {
    const metadata = AppDataSource.getMetadata(Clip);
    const statusColumn = metadata.columns.find(
      (c) => c.propertyName === "status",
    );
    expect(statusColumn).toBeTruthy();
    expect(statusColumn!.default).toBe("queued");
  });
});

// ---------------------------------------------------------------------------
// asJSON
// ---------------------------------------------------------------------------

describe("Clip.asJSON", () => {
  it("returns the public shape without internal fields", async () => {
    const upload = await createTestUpload();
    const repo = AppDataSource.getRepository(Clip);

    const clip = new Clip();
    clip.upload = upload;
    clip.status = "ready";
    clip.outputPaths = {
      video: "clips/video.mp4",
      poster: "clips/poster.jpg",
    };
    clip.kit = { caption: "test caption", hashtags: ["#pizza"] };
    clip.approvedBy = "agent-42";
    clip.approvedAt = new Date("2025-06-01T12:00:00Z");
    clip.failureReason = null;
    clip.publishLog = [{ platform: "tiktok", postedAt: "2025-06-02" }];

    await repo.save(clip);

    const found = await repo.findOne({
      where: { id: clip.id },
      relations: ["upload"],
    });
    expect(found).toBeTruthy();

    const json = found!.asJSON();

    // Public shape includes these keys
    expect(json).toHaveProperty("id", found!.id);
    expect(json).toHaveProperty("status", "ready");
    expect(json).toHaveProperty("uploadId", upload.id);
    expect(json).toHaveProperty("outputPaths");
    expect(json.outputPaths).toEqual({
      video: "clips/video.mp4",
      poster: "clips/poster.jpg",
    });
    expect(json).toHaveProperty("kit");
    expect(json.kit).toEqual({ caption: "test caption", hashtags: ["#pizza"] });
    expect(json).toHaveProperty("approvedBy", "agent-42");
    expect(json).toHaveProperty("approvedAt");
    expect(json).toHaveProperty("createdAt");
    expect(json).toHaveProperty("updatedAt");

    // Internal fields must NOT leak
    expect(json).not.toHaveProperty("failureReason");
    expect(json).not.toHaveProperty("publishLog");
  });
});

// ---------------------------------------------------------------------------
// DB roundtrip
// ---------------------------------------------------------------------------

describe("Clip DB persistence", () => {
  it("defaults status to queued on new rows", async () => {
    const upload = await createTestUpload();
    const repo = AppDataSource.getRepository(Clip);

    const clip = new Clip();
    clip.upload = upload;
    await repo.save(clip);

    expect(clip.status).toBe("queued");
    expect(clip.id).toBeGreaterThan(0);

    const loaded = await repo.findOne({
      where: { id: clip.id },
      relations: ["upload"],
    });
    expect(loaded).toBeTruthy();
    expect(loaded!.status).toBe("queued");
    expect(loaded!.upload.id).toBe(upload.id);
  });

  it("persists and reloads full clip data including JSONB columns", async () => {
    const upload = await createTestUpload();
    const repo = AppDataSource.getRepository(Clip);

    const clip = new Clip();
    clip.upload = upload;
    clip.status = "ready";
    clip.outputPaths = {
      video: "clips/city-state/video.mp4",
      poster: "clips/city-state/poster.jpg",
      captions: "clips/city-state/captions.srt",
      kit: "clips/city-state/kit.json",
    };
    clip.kit = {
      caption: "Pizza is here!",
      hashtags: ["#pizza", "#democracy"],
      shortUrlSlug: "abc123",
      city: "Chicago",
      state: "IL",
      reportedAt: "2025-06-03T10:00:00Z",
    };
    clip.publishLog = [
      { platform: "tiktok", postedAt: "2025-06-03T11:00:00Z", postedBy: "bot" },
    ];
    clip.approvedBy = "operator-7";
    clip.approvedAt = new Date("2025-06-03T09:00:00Z");

    await repo.save(clip);

    const loaded = await repo.findOne({
      where: { id: clip.id },
      relations: ["upload"],
    });

    expect(loaded).toBeTruthy();
    expect(loaded!.status).toBe("ready");
    expect(loaded!.upload.id).toBe(upload.id);
    expect(loaded!.outputPaths).toEqual({
      video: "clips/city-state/video.mp4",
      poster: "clips/city-state/poster.jpg",
      captions: "clips/city-state/captions.srt",
      kit: "clips/city-state/kit.json",
    });
    expect(loaded!.kit).toEqual({
      caption: "Pizza is here!",
      hashtags: ["#pizza", "#democracy"],
      shortUrlSlug: "abc123",
      city: "Chicago",
      state: "IL",
      reportedAt: "2025-06-03T10:00:00Z",
    });
    expect(loaded!.publishLog).toEqual([
      { platform: "tiktok", postedAt: "2025-06-03T11:00:00Z", postedBy: "bot" },
    ]);
    expect(loaded!.approvedBy).toBe("operator-7");
    expect(loaded!.approvedAt).toEqual(new Date("2025-06-03T09:00:00Z"));
  });

  it("enforces the upload FK constraint (non-null join column)", async () => {
    const repo = AppDataSource.getRepository(Clip);
    const clip = new Clip();
    clip.status = "queued";

    // Saving without an upload should fail the FK constraint.
    await expect(repo.save(clip)).rejects.toThrow();
  });

  it("allows nullable fields to be null", async () => {
    const upload = await createTestUpload();
    const repo = AppDataSource.getRepository(Clip);

    const clip = new Clip();
    clip.upload = upload;
    await repo.save(clip);

    const loaded = await repo.findOne({ where: { id: clip.id } });
    expect(loaded).toBeTruthy();
    expect(loaded!.failureReason).toBeNull();
    expect(loaded!.outputPaths).toBeNull();
    expect(loaded!.kit).toBeNull();
    expect(loaded!.publishLog).toBeNull();
    expect(loaded!.approvedBy).toBeNull();
    expect(loaded!.approvedAt).toBeNull();
  });
});
