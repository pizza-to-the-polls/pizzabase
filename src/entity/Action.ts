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

  @Column({ nullable: true })
  @Index()
  user: string;

  @Column({ nullable: true })
  @Index()
  actionType: string;

  @Column({ nullable: true })
  @Index()
  entityId: number;

  @Column({ nullable: true })
  @Index()
  entityType: string;

  @Column({ name: "user_id", nullable: true })
  @Index()
  userId: string;

  @Column({ name: "action_type", nullable: true })
  @Index()
  actionTypeTemp: string;

  @Column({ name: "entity_id", nullable: true })
  @Index()
  entityIdTemp: number;

  @Column({ name: "entity_type", nullable: true })
  @Index()
  entityTypeTemp: string;

  static async log(entity, actionType, user?: string): Promise<Action> {
    const action = new this();

    action.user = user || "not specified";
    action.userId = user || "not specified";
    action.actionType = actionType;
    action.actionTypeTemp = actionType;

    action.entityType = entity.constructor.name;
    action.entityTypeTemp = entity.constructor.name;
    action.entityId = entity.id;
    action.entityIdTemp = entity.id;

    await action.save();

    return action;
  }
}
