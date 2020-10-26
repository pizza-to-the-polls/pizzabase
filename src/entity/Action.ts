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

  @Column({ name: 'user_id', nullable: true })
  @Index()
  user_id: string;

  @Column({ name: 'action_type', nullable: true })
  @Index()
  action_type: string;

  @Column({ name: 'entity_id', nullable: true })
  @Index()
  entity_id: number;

  @Column({ name: 'entity_type', nullable: true })
  @Index()
  entity_type: string;

  static async log(entity, actionType, user?: string): Promise<Action> {
    const action = new this();

    action.user = user || "not specified";
    action.user_id = user || "not specified";
    action.actionType = actionType;
    action.action_type = actionType;

    action.entityType = entity.constructor.name;
    action.entity_type = entity.constructor.name;
    action.entityId = entity.id;
    action.entity_id = entity.id;

    await action.save();

    return action;
  }
}
