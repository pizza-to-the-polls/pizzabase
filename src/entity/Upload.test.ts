import { AppDataSource } from "../data-source";
import { Upload, UploadSource } from "./Upload";
import { Report } from "./Report";
import { Location } from "./Location";
import { NormalAddress } from "../lib/validator";

const ADDRESS: NormalAddress = {
  latitude: 41.79907,
  longitude: -87.58413,
  fullAddress: "5335 S Kimbark Ave Chicago IL 60615",
  address: "5335 S Kimbark Ave",
  city: "Chicago",
  state: "IL",
  zip: "60615",
};

describe("Upload entity", () => {
  it("metadata exposes source, sourcePhone columns and a nullable report relation", () => {
    const metadata = AppDataSource.getMetadata(Upload);
    const columnNames = metadata.columns.map((column) => column.propertyName);

    expect(columnNames).toContain("source");
    expect(columnNames).toContain("sourcePhone");

    // source must be backed by the upload_source enum with a web default
    const sourceColumn = metadata.findColumnWithPropertyName("source");
    expect(sourceColumn?.enumName).toEqual("upload_source");
    expect(sourceColumn?.default).toEqual("web");

    // source_phone is a nullable varchar
    const phoneColumn = metadata.findColumnWithPropertyName("sourcePhone");
    expect(phoneColumn?.isNullable).toBe(true);

    // report is a nullable ManyToOne joined on report_id
    const relation = metadata.findRelationWithPropertyPath("report");
    expect(relation).toBeDefined();
    expect(relation!.isNullable).toBe(true);
    expect(relation!.onDelete).toEqual("SET NULL");
    expect(relation!.joinColumns.map((jc) => jc.databaseName)).toEqual([
      "report_id",
    ]);
  });

  describe("#createFromMms", () => {
    let report: Report;

    beforeEach(async () => {
      const location = await Location.createFromAddress(ADDRESS);
      [report] = await Report.createNewReport(
        "+14255551234",
        "http://twitter.com/mms-test/1",
        ADDRESS,
      );
      expect(report.location.id).toEqual(location.id);
    });

    it("creates an mms upload linked to the report with the report's location", async () => {
      const [upload, isDuplicate] = await Upload.createFromMms(report, {
        fileExt: "jpg",
        fileHash: "mms-hash-1",
        sourcePhone: "+14255551234",
      });

      expect(isDuplicate).toBe(false);
      expect(upload.source).toEqual<UploadSource>("mms");
      expect(upload.ipAddress).toEqual("mms");
      expect(upload.sourcePhone).toEqual("+14255551234");
      expect(upload.mediaStatus).toEqual("processing");
      expect(upload.location.id).toEqual(report.location.id);
      expect(upload.report!.id).toEqual(report.id);
      expect(upload.rawBucket).toEqual(
        process.env.RAW_UPLOADS_BUCKET || "raw.polls.pizza",
      );
      expect(upload.sightengineScore).toBeNull();

      // Reload with the report relation to verify what actually persisted.
      const loaded = await AppDataSource.getRepository(Upload).findOne({
        where: { id: upload.id },
        relations: ["report"],
      });
      expect(loaded!.source).toEqual("mms");
      expect(loaded!.sourcePhone).toEqual("+14255551234");
      expect(loaded!.report!.id).toEqual(report.id);
    });

    it("stores filePath under the uploads/ prefix with a lowercased dashed name", async () => {
      const [upload] = await Upload.createFromMms(report, {
        fileExt: "JPG",
        fileHash: "mms-hash-path",
        sourcePhone: "+14255551234",
      });

      expect(upload.filePath).toEqual(upload.rawFilePath);
      expect(upload.filePath.startsWith("uploads/")).toBe(true);
      expect(upload.filePath.endsWith(".jpg")).toBe(true);
      expect(upload.filePath).toEqual(upload.filePath.toLowerCase());
      expect(upload.filePath).not.toMatch(/\s/);
      expect(upload.filePath).toContain("uploads/chicago-il-");
    });

    it("does not call Location.getOrCreateFromAddress (reuses report.location)", async () => {
      const [upload] = await Upload.createFromMms(report, {
        fileExt: "png",
        fileHash: "mms-hash-loc",
        sourcePhone: "+14255551234",
      });

      const locations = await AppDataSource.getRepository(Location).find();
      expect(locations).toHaveLength(1);
      expect(upload.location.id).toEqual(locations[0].id);
    });

    it("dedupes by fileHash and returns the existing upload", async () => {
      const [first, firstDuplicate] = await Upload.createFromMms(report, {
        fileExt: "jpg",
        fileHash: "same-hash",
        sourcePhone: "+14255551234",
      });
      const [second, secondDuplicate] = await Upload.createFromMms(report, {
        fileExt: "jpg",
        fileHash: "same-hash",
        sourcePhone: "+14255551234",
      });

      expect(firstDuplicate).toBe(false);
      expect(secondDuplicate).toBe(true);
      expect(second.id).toEqual(first.id);

      const count = await AppDataSource.getRepository(Upload).count();
      expect(count).toEqual(1);
    });

    it("rate-limits by sender phone after UPLOAD_MAX mms uploads", async () => {
      for (let i = 0; i < 6; ++i) {
        await Upload.createFromMms(report, {
          fileExt: "jpg",
          fileHash: `rate-hash-${i}`,
          sourcePhone: "+14255551234",
        });
      }

      await expect(
        Upload.createFromMms(report, {
          fileExt: "jpg",
          fileHash: "rate-hash-6",
          sourcePhone: "+14255551234",
        }),
      ).rejects.toThrow(
        "Whoops! You've had too many uploads recently - slow your roll",
      );
    });

    it("isolates rate limits between different sender phones", async () => {
      for (let i = 0; i < 6; ++i) {
        await Upload.createFromMms(report, {
          fileExt: "jpg",
          fileHash: `phone-a-${i}`,
          sourcePhone: "+14255550000",
        });
      }

      const [upload, isDuplicate] = await Upload.createFromMms(report, {
        fileExt: "jpg",
        fileHash: "phone-b-0",
        sourcePhone: "+14255551111",
      });

      expect(isDuplicate).toBe(false);
      expect(upload.sourcePhone).toEqual("+14255551111");
    });

    it("rate limit ignores web uploads and vice versa", async () => {
      // 6 web uploads for one IP (reusing the location from beforeEach; a
      // second createFromAddress would violate the unique full_address).
      const location = report.location;
      await Promise.all(
        Array(6)
          .fill(null)
          .map(async (_, i) => {
            const upload = new Upload();
            upload.ipAddress = "10.0.0.1";
            upload.filePath = `web-${i}.png`;
            upload.location = location;
            upload.fileHash = `web-hash-${i}`;
            await upload.save();
          }),
      );

      // ...must not consume the mms sender's budget.
      const [upload, isDuplicate] = await Upload.createFromMms(report, {
        fileExt: "jpg",
        fileHash: "mms-after-web",
        sourcePhone: "+14255551234",
      });
      expect(isDuplicate).toBe(false);
      expect(upload.source).toEqual("mms");
    });
  });

  describe("web flow regression (#createOrReject defaults)", () => {
    it("web uploads default to source=web with no report or source phone", async () => {
      const [upload] = await Upload.createOrReject("127.0.0.1", {
        fileExt: "jpg",
        fileHash: "web-default-hash",
        normalizedAddress: ADDRESS,
      });

      const loaded = await AppDataSource.getRepository(Upload).findOne({
        where: { id: upload.id },
        relations: ["report"],
      });

      expect(loaded!.source).toEqual("web");
      expect(loaded!.report).toBeNull();
      expect(loaded!.sourcePhone).toBeNull();
      expect(loaded!.ipAddress).toEqual("127.0.0.1");
      expect(loaded!.mediaStatus).toEqual("processing");
    });
  });
});
