/**
 * Handler tests for the compileClips lambda (scheduled compilation).
 *
 * S3 is mocked at the SDK boundary, ffmpeg execution is mocked, and fs is
 * mocked so the "download → normalize → concat → upload" pipeline runs
 * without a binary or disk. Clip/Upload rows live in the real test
 * database so the compiled_at gating and the compilation row (upload NULL)
 * are verified end-to-end.
 */
import { Clip } from "../../entity/Clip";
import { Location } from "../../entity/Location";
import { Upload } from "../../entity/Upload";
import { runFfmpeg } from "../../lib/ffmpeg-exec";
import { notifyClipKit } from "../../lib/clipKit";

const mockS3Send = jest.fn();

jest.mock("@aws-sdk/client-s3", () => {
  const original = jest.requireActual("@aws-sdk/client-s3");
  return {
    ...original,
    S3Client: jest.fn(() => ({ send: mockS3Send })),
    GetObjectCommand: jest.fn((input: Record<string, unknown>) => ({
      input,
      commandName: "GetObject",
    })),
    PutObjectCommand: jest.fn((input: Record<string, unknown>) => ({
      input,
      commandName: "PutObject",
    })),
  };
});

jest.mock("../../lib/ffmpeg-exec", () => ({
  runFfmpeg: jest.fn(),
}));

jest.mock("../../lib/clipKit", () => ({
  notifyClipKit: jest.fn(),
}));

// fs/promises: capture writes; reads return fake bytes for any path.
jest.mock("fs/promises", () => ({
  mkdir: jest.fn(async () => undefined),
  writeFile: jest.fn(async () => undefined),
  readFile: jest.fn(async (p: string) => Buffer.from(`bytes:${p}`)),
  rm: jest.fn(async () => undefined),
}));

const mockRunFfmpeg = runFfmpeg as jest.Mock;
const mockNotifyClipKit = notifyClipKit as jest.Mock;

let uploadCounter = 0;

const makeUpload = async (): Promise<Upload> => {
  uploadCounter += 1;
  const location = await Location.createFromAddress({
    latitude: 45.523064,
    longitude: -122.676483,
    fullAddress: `123 Main St, Portland, OR 97204 #${uploadCounter}`,
    address: "123 Main St",
    city: "Portland",
    state: "OR",
    zip: "97204",
  });
  const upload = new Upload();
  upload.ipAddress = "127.0.0.1";
  upload.filePath = `uploads/compile-test-${uploadCounter}.mp4`;
  upload.fileHash = `compile-test-hash-${uploadCounter}`;
  upload.location = location;
  upload.moderationStatus = "clean";
  upload.mediaStatus = "ready";
  await upload.save();
  return upload;
};

const makeMember = async (
  outputPaths: Record<string, string> | null,
  status: Clip["status"] = "ready",
): Promise<Clip> => {
  const upload = await makeUpload();
  const clip = new Clip();
  clip.upload = upload;
  clip.status = status;
  clip.kit = {
    city: "Portland",
    state: "OR",
    photoLinks: [],
  };
  clip.outputPaths = outputPaths;
  await clip.save();
  return clip;
};

function s3ServesMemberVideos(): void {
  mockS3Send.mockImplementation(async (cmd: any) => {
    if (cmd.commandName === "GetObject") {
      return {
        Body: { transformToByteArray: async () => Buffer.from("member-mp4") },
      };
    }
    return {}; // PutObject
  });
}

function putCalls(): any[] {
  return mockS3Send.mock.calls
    .filter(([cmd]: any[]) => cmd.commandName === "PutObject")
    .map(([cmd]: any[]) => cmd.input);
}

let runCompilation: () => Promise<Clip | null>;

beforeAll(async () => {
  // Imported after the mocks above so the module-level S3Client picks up
  // the mocked constructor.
  const mod = await import("../compileClips");
  runCompilation = mod.runCompilation;
});

beforeEach(() => {
  jest.clearAllMocks();
  mockRunFfmpeg.mockResolvedValue(undefined);
  mockNotifyClipKit.mockResolvedValue(undefined);
  process.env.PIZZABASE_API_URL = "https://base.polls.pizza";
});

afterEach(() => {
  delete process.env.PIZZABASE_API_URL;
});

describe("runCompilation", () => {
  it("is a no-op with no new content — no compilation, no puts, no notify", async () => {
    const result = await runCompilation();

    expect(result).toBeNull();
    expect(putCalls()).toHaveLength(0);
    expect(mockNotifyClipKit).not.toHaveBeenCalled();
  });

  it("joins new member clips into a compilation and posts the kit", async () => {
    const first = await makeMember({ video: `clips/101/clip.mp4` });
    const second = await makeMember({ video: `clips/102/clip.mp4` });
    s3ServesMemberVideos();

    const compilation = await runCompilation();

    expect(compilation).toBeTruthy();
    expect(compilation!.upload).toBeNull();
    expect(compilation!.status).toBe("approved");
    expect(compilation!.approvedBy).toBe("compile-clips");
    expect(compilation!.kit).toMatchObject({
      isCompilation: true,
      memberClipIds: [first.id, second.id],
      photoLinks: [
        `https://base.polls.pizza/uploads/compile-test-${uploadCounter - 1}.mp4`,
        `https://base.polls.pizza/uploads/compile-test-${uploadCounter}.mp4`,
      ],
      // Rich per-member photo entries: address present, pizza data null
      // (no orders at the fixture locations).
      photos: [
        expect.objectContaining({ city: "Portland", state: "OR" }),
        expect.objectContaining({ city: "Portland", state: "OR" }),
      ],
    });
    expect(compilation!.outputPaths).toEqual({
      video: `clips/${compilation!.id}/clip.mp4`,
      poster: `clips/${compilation!.id}/poster.jpg`,
    });

    // Two member uploads: reel + poster.
    const puts = putCalls();
    expect(puts).toHaveLength(2);
    expect(puts.map((p) => p.Key)).toEqual([
      `clips/${compilation!.id}/clip.mp4`,
      `clips/${compilation!.id}/poster.jpg`,
    ]);

    // ffmpeg: normalize × members + concat + poster extract.
    expect(mockRunFfmpeg).toHaveBeenCalledTimes(4);
    const concatCall = mockRunFfmpeg.mock.calls[2];
    expect(concatCall[1]).toContain("-f");
    expect(concatCall[1]).toContain("concat");

    // Kit notification fired with the compilation.
    expect(mockNotifyClipKit).toHaveBeenCalledTimes(1);
    expect(mockNotifyClipKit.mock.calls[0][0].id).toBe(compilation!.id);

    // Members are marked compiled so the next run skips them.
    const reloadedFirst = (await Clip.findOne({
      where: { id: first.id },
    }))!;
    const reloadedSecond = (await Clip.findOne({
      where: { id: second.id },
    }))!;
    expect(reloadedFirst.compiledAt).toBeTruthy();
    expect(reloadedSecond.compiledAt).toBeTruthy();
  });

  it("skips members without render output instead of failing the run", async () => {
    const noOutput = await makeMember(null);
    const withOutput = await makeMember({ video: "clips/x/clip.mp4" });
    s3ServesMemberVideos();

    const compilation = await runCompilation();

    expect(compilation).toBeTruthy();
    expect(compilation!.kit).toMatchObject({
      memberClipIds: [withOutput.id],
    });
    // The skipped member stays uncompiled for a later retry.
    const reloaded = (await Clip.findOne({
      where: { id: noOutput.id },
    }))!;
    expect(reloaded.compiledAt).toBeNull();
  });

  it("exits quietly when every member download fails", async () => {
    await makeMember({ video: "clips/x/clip.mp4" });
    mockS3Send.mockImplementation(async (cmd: any) => {
      if (cmd.commandName === "GetObject") {
        throw new Error("S3 down");
      }
      return {};
    });

    const compilation = await runCompilation();

    expect(compilation).toBeNull();
    expect(putCalls()).toHaveLength(0);
    expect(mockNotifyClipKit).not.toHaveBeenCalled();
  });

  it("ignores previously compiled clips and compilation rows", async () => {
    const compiled = await makeMember({ video: "clips/c/clip.mp4" });
    compiled.compiledAt = new Date();
    await compiled.save();

    // A stale compilation row (upload NULL) must not be a candidate.
    const stale = new Clip();
    stale.upload = null;
    stale.status = "ready";
    stale.kit = { isCompilation: true, memberClipIds: [compiled.id] };
    stale.outputPaths = { video: "clips/old/clip.mp4" };
    await stale.save();

    const fresh = await makeMember({ video: "clips/f/clip.mp4" });
    s3ServesMemberVideos();

    const compilation = await runCompilation();

    expect(compilation).toBeTruthy();
    expect(compilation!.kit).toMatchObject({
      memberClipIds: [fresh.id],
    });
  });

  it("includes approved and published members, not queued ones", async () => {
    const approved = await makeMember(
      { video: "clips/a/clip.mp4" },
      "approved",
    );
    const published = await makeMember(
      { video: "clips/p/clip.mp4" },
      "published",
    );
    await makeMember({ video: "clips/q/clip.mp4" }, "queued");
    s3ServesMemberVideos();

    const compilation = await runCompilation();

    expect(compilation!.kit).toMatchObject({
      memberClipIds: [approved.id, published.id],
    });
  });
});
