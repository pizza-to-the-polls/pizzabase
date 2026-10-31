import {
  BaseEntity,
  PrimaryGeneratedColumn,
  Entity,
  CreateDateColumn,
  Index,
  Column,
} from "typeorm";

@Index("IDX_actions_entity_type_entity_id", ["entityType", "entityId"])
@Index("IDX_actions_action_type_created_at", ["actionType", "createdAt"])
// NB: the migration also INCLUDEs user_id in the (action_type, created_at)
// index — TypeORM decorators can't express INCLUDE payloads.
@Entity({ name: "actions" })
export class Action extends BaseEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @CreateDateColumn({ name: "created_at" })
  createdAt;

  @Column({ name: "user_id", type: "text" })
  @Index()
  userId: string;

  @Column({ name: "entity_type" })
  @Index()
  entityType: string;

  @Column({ name: "entity_id" })
  @Index()
  entityId: number;

  @Column({ name: "action_type" })
  @Index()
  actionType: string;

  static async log(entity, actionType, user?: string): Promise<Action> {
    const action = new this();

    action.userId = user || "not specified";
    action.actionType = actionType;

    action.entityType = entity.constructor.name;
    action.entityId = entity.id;

    await action.save();

    return action;
  }
}
