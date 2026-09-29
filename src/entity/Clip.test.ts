import { AppDataSource } from "../data-source";
import { Clip, ClipStatus } from "./Clip";
import { Upload } from "./Upload";
import { Location } from "./Location";

describe("Clip.canTransition", () => {
  const validTransitions: [ClipStatus, ClipStatus][] = [
    ["queued", "rendering"],
    ["rendering", "ready"],
    ["rendering", "rejected"],
    ["ready", "approved"],
    ["ready", "rejected"],
    ["approved", "published"],
    ["approved", "rejected"],
    ["rejected", "queued"],
  ];

  const allStatuses: ClipStatus[] = [
    "queued",
    "rendering",
    "ready",
    "approved",
    "published",
    "rejected",
  ];

  it.each(validTransitions)("allows %s → %s", (from, to) => {
    expect(Clip.canTransition(from, to)).toBe(true);
  });

  it("rejects every transition not in the allowed set", () => {
    const allowed = new Set(validTransitions.map(([f, t]) => `${f}→${t}`));

    for (const from of allStatuses) {
      for (const to of allStatuses) {
        const key = `${from}→${to}`;
        expect(Clip.canTransition(from, to)).toBe(allowed.has(key));
      }
    }
  });

  it("published is a terminal state — no outgoing transitions", () => {
    expect(Clip.canTransition("published", "published")).toBe(false);
    expect(Clip.canTransition("published", "ready")).toBe(false);
    expect(Clip.canTransition("published", "queued")).toBe(false);
  });

  it("rejects self-transitions for non-terminal states", () => {
    expect(Clip.canTransition("queued", "queued")).toBe(false);
    expect(Clip.canTransition("rendering", "rendering")).toBe(false);
    expect(Clip.canTransition("ready", "ready")).toBe(false);
    expect(Clip.canTransition("approved", "approved")).toBe(false);
    expect(Clip.canTransition("rejected", "rejected")).toBe(false);
  });
});

describe("Clip.asJSON", () => {
  it("returns the public shape with expected keys", () => {
    const clip = new Clip();
    clip.id = 1;
    clip.createdAt = new Date("2025-01-15T12:00:00Z");
    clip.updatedAt = new Date("2025-01-15T13:00:00Z");
    clip.status = "ready";
    clip.outputPaths = {
      video: "s3://bucket/video.mp4",
      poster: "s3://bucket/poster.jpg",
    };
    clip.kit = null;
    // Internal fields — should not leak
    clip.failureReason = null;
    clip.publishLog = null;
    clip.approvedBy = null;
    clip.approvedAt = null;

    const json = clip.asJSON();

    expect(json).toEqual({
      id: 1,
      createdAt: new Date("2025-01-15T12:00:00Z"),
      updatedAt: new Date("2025-01-15T13:00:00Z"),
      status: "ready",
      outputPaths: {
        video: "s3://bucket/video.mp4",
        poster: "s3://bucket/poster.jpg",
      },
      kit: null,
    });

    // Verify no sensitive fields leak
    expect(json).not.toHaveProperty("failureReason");
    expect(json).not.toHaveProperty("publishLog");
    expect(json).not.toHaveProperty("approvedBy");
    expect(json).not.toHaveProperty("approvedAt");
  });

  it("includes a limited kit subset when kit is present", () => {
    const clip = new Clip();
    clip.id = 1;
    clip.createdAt = new Date();
    clip.updatedAt = new Date();
    clip.status = "ready";
    clip.outputPaths = null;
    clip.kit = {
      caption: "Pizza for everyone!",
      hashtags: ["#pizza", "#democracy"],
      shortUrlSlug: "philly-123",
      city: "Philadelphia",
      state: "PA",
      reportedAt: "2025-01-15",
    };

    const json = clip.asJSON();

    expect(json.kit).toEqual({
      caption: "Pizza for everyone!",
      hashtags: ["#pizza", "#democracy"],
      shortUrlSlug: "philly-123",
    });
    // Extra kit fields do NOT leak
    expect((json.kit as Record<string, unknown>).city).toBeUndefined();
  });
});

describe("Clip entity round-trip", () => {
  it("saves and reloads all fields correctly", async () => {
    const locationRepo = AppDataSource.getRepository(Location);
    const uploadRepo = AppDataSource.getRepository(Upload);
    const clipRepo = AppDataSource.getRepository(Clip);

    // Create prerequisite Location and Upload
    const location = new Location();
    location.fullAddress = "100 Test St, City, OR 97201";
    location.address = "100 Test St";
    location.city = "City";
    location.state = "OR";
    location.zip = "97201";
    location.lat = "45.5";
    location.lng = "-122.6";
    await locationRepo.save(location);

    const upload = new Upload();
    upload.location = location;
    upload.ipAddress = "127.0.0.1";
    upload.filePath = "uploads/city-or-test.mp4";
    upload.fileHash = "hash-230";
    await uploadRepo.save(upload);

    // Create and save a Clip
    const clip = new Clip();
    clip.upload = upload;
    clip.status = "queued";
    clip.outputPaths = { video: "/out/video.mp4" };
    clip.kit = {
      caption: "Hello",
      hashtags: ["#test"],
      shortUrlSlug: "slug-1",
    };
    clip.publishLog = [
      { platform: "tiktok", postedAt: new Date().toISOString() },
    ];
    clip.failureReason = null;
    clip.approvedBy = null;
    clip.approvedAt = null;
    await clipRepo.save(clip);

    // Reload
    const loaded = await clipRepo.findOne({
      where: { id: clip.id },
      relations: ["upload"],
    });

    expect(loaded).toBeTruthy();
    expect(loaded!.id).toBe(clip.id);
    expect(loaded!.status).toBe("queued");
    expect(loaded!.outputPaths).toEqual({ video: "/out/video.mp4" });
    expect(loaded!.kit).toEqual({
      caption: "Hello",
      hashtags: ["#test"],
      shortUrlSlug: "slug-1",
    });
    expect(loaded!.publishLog).toEqual([
      { platform: "tiktok", postedAt: expect.any(String) },
    ]);
    expect(loaded!.upload.id).toBe(upload.id);
  });

  it("enforces NOT NULL on upload_id", async () => {
    const clipRepo = AppDataSource.getRepository(Clip);
    const clip = new Clip();
    clip.status = "queued";

    await expect(clipRepo.save(clip)).rejects.toThrow();
  });
});

describe("Clip ←→ Upload relation", () => {
  it("bidirectional: upload.clips contains the saved clip", async () => {
    const locationRepo = AppDataSource.getRepository(Location);
    const uploadRepo = AppDataSource.getRepository(Upload);
    const clipRepo = AppDataSource.getRepository(Clip);

    const location = new Location();
    location.fullAddress = "200 Relation St, City, WA 98101";
    location.address = "200 Relation St";
    location.city = "City";
    location.state = "WA";
    location.zip = "98101";
    location.lat = "47.6";
    location.lng = "-122.3";
    await locationRepo.save(location);

    const upload = new Upload();
    upload.location = location;
    upload.ipAddress = "192.168.0.1";
    upload.filePath = "uploads/relation-test.mp4";
    upload.fileHash = "hash-231";
    await uploadRepo.save(upload);

    const clip = new Clip();
    clip.upload = upload;
    clip.status = "rendering";
    await clipRepo.save(clip);

    // Load clips through the Upload side
    const reloadedUpload = await uploadRepo.findOne({
      where: { id: upload.id },
      relations: ["clips"],
    });
    expect(reloadedUpload).toBeTruthy();
    const clips = await reloadedUpload!.clips;
    expect(clips.length).toBe(1);
    expect(clips[0].id).toBe(clip.id);
    expect(clips[0].status).toBe("rendering");
  });
});
