import {
  BaseEntity,
  PrimaryGeneratedColumn,
  Entity,
  CreateDateColumn,
  Index,
  Column,
} from "typeorm";

import { v4 as uuidv4 } from "uuid";

@Entity({ name: "api_keys" })
export class APIKey extends BaseEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @CreateDateColumn({ name: "created_at" })
  createdAt;

  @Column({ unique: true })
  @Index({ unique: true })
  key: string;

  @Column({ nullable: true })
  description: string;

  static async generate(description?: string): Promise<APIKey> {
    const apiKey = new this();
    apiKey.key = uuidv4();
    apiKey.description = description;
    await apiKey.save();

    return apiKey;
  }
}
