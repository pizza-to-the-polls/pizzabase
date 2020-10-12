import {
  BaseEntity,
  PrimaryGeneratedColumn,
  Entity,
  CreateDateColumn,
  Index,
  Column,
} from "typeorm";

@Entity({ name: "actions" })
export class Action extends BaseEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @CreateDateColumn({ name: "created_at" })
  createdAt;

  @Column()
  @Index()
  user: string;

  @Column()
  @Index()
  actionType: string;

  @Column()
  @Index()
  entityId: number;

  @Column()
  @Index()
  entityType: string;

  static async log(entity, actionType, user?: string): Promise<Action> {
    const action = new this();

    action.user = user || "not specified";
    action.actionType = actionType;

    action.entityType = entity.constructor.name;
    action.entityId = entity.id;

    await action.save();

    return action;
  }
}
