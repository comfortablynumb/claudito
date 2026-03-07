export interface RoadmapTask {
  title: string;
  completed: boolean;
}

export interface RoadmapMilestone {
  id: string;
  title: string;
  tasks: RoadmapTask[];
  completedCount: number;
  totalCount: number;
}

export interface RoadmapPhase {
  id: string;
  title: string;
  milestones: RoadmapMilestone[];
}

export interface ParsedRoadmap {
  phases: RoadmapPhase[];
  currentPhase: string | null;
  currentMilestone: string | null;
  overallProgress: number;
}

export interface RoadmapParser {
  parse(content: string): ParsedRoadmap;
}

export interface DeleteTaskParams {
  phaseId: string;
  milestoneId: string;
  taskIndex: number;
}

export interface DeleteMilestoneParams {
  phaseId: string;
  milestoneId: string;
}

export interface DeletePhaseParams {
  phaseId: string;
}

export interface AddTaskParams {
  phaseId: string;
  milestoneId: string;
  taskTitle: string;
}

export interface RoadmapEditor {
  deleteTask(content: string, params: DeleteTaskParams): string;
  deleteMilestone(content: string, params: DeleteMilestoneParams): string;
  deletePhase(content: string, params: DeletePhaseParams): string;
  addTask(content: string, params: AddTaskParams): string;
}

interface ParserContext {
  currentPhase: RoadmapPhase | null;
  currentMilestone: RoadmapMilestone | null;
}

export class MarkdownRoadmapEditor implements RoadmapEditor {
  private parser: RoadmapParser;

  constructor(parser: RoadmapParser) {
    this.parser = parser;
  }

  deleteTask(content: string, params: DeleteTaskParams): string {
    const parsed = this.parser.parse(content);
    const phase = this.findPhaseById(parsed.phases, params.phaseId);

    if (!phase) {
      throw new Error(`Phase not found: ${params.phaseId}`);
    }

    const milestone = this.findMilestoneById(phase.milestones, params.milestoneId);

    if (!milestone) {
      throw new Error(`Milestone not found: ${params.milestoneId}`);
    }

    if (params.taskIndex < 0 || params.taskIndex >= milestone.tasks.length) {
      throw new Error(`Invalid task index: ${params.taskIndex}`);
    }

    return this.removeTaskFromContent(content, phase.title, milestone.title, params.taskIndex);
  }

  deleteMilestone(content: string, params: DeleteMilestoneParams): string {
    const parsed = this.parser.parse(content);
    const phase = this.findPhaseById(parsed.phases, params.phaseId);

    if (!phase) {
      throw new Error(`Phase not found: ${params.phaseId}`);
    }

    const milestone = this.findMilestoneById(phase.milestones, params.milestoneId);

    if (!milestone) {
      throw new Error(`Milestone not found: ${params.milestoneId}`);
    }

    return this.removeMilestoneFromContent(content, phase.title, milestone.title);
  }

  deletePhase(content: string, params: DeletePhaseParams): string {
    const parsed = this.parser.parse(content);
    const phase = this.findPhaseById(parsed.phases, params.phaseId);

    if (!phase) {
      throw new Error(`Phase not found: ${params.phaseId}`);
    }

    return this.removePhaseFromContent(content, phase.title);
  }

  addTask(content: string, params: AddTaskParams): string {
    const parsed = this.parser.parse(content);
    const phase = this.findPhaseById(parsed.phases, params.phaseId);

    if (!phase) {
      throw new Error(`Phase not found: ${params.phaseId}`);
    }

    const milestone = this.findMilestoneById(phase.milestones, params.milestoneId);

    if (!milestone) {
      throw new Error(`Milestone not found: ${params.milestoneId}`);
    }

    return this.appendTaskToMilestone(content, phase.title, milestone.title, params.taskTitle);
  }

  private findPhaseById(phases: RoadmapPhase[], phaseId: string): RoadmapPhase | null {
    return phases.find(p => p.id === phaseId) || null;
  }

  private findMilestoneById(
    milestones: RoadmapMilestone[],
    milestoneId: string
  ): RoadmapMilestone | null {
    return milestones.find(m => m.id === milestoneId) || null;
  }

  private appendTaskToMilestone(
    content: string,
    phaseTitle: string,
    milestoneTitle: string,
    taskTitle: string
  ): string {
    const lines = content.split(/\r?\n/);
    const result: string[] = [];
    let inTargetPhase = false;
    let inTargetMilestone = false;
    let lastTaskLineIndex = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;

      if (this.isPhaseHeader(line)) {
        if (inTargetMilestone && lastTaskLineIndex >= 0) {
          result.splice(lastTaskLineIndex + 1, 0, `- [ ] ${taskTitle}`);
          return result.concat(lines.slice(i)).join('\n');
        }
        inTargetPhase = line.includes(phaseTitle);
        inTargetMilestone = false;
      } else if (this.isMilestoneHeader(line)) {
        if (inTargetMilestone && lastTaskLineIndex >= 0) {
          result.splice(lastTaskLineIndex + 1, 0, `- [ ] ${taskTitle}`);
          return result.concat(lines.slice(i)).join('\n');
        }
        inTargetMilestone = inTargetPhase && line.includes(milestoneTitle);
        lastTaskLineIndex = -1;
      } else if (this.isTaskLine(line) && inTargetMilestone) {
        lastTaskLineIndex = result.length;
      }

      result.push(line);
    }

    if (inTargetMilestone && lastTaskLineIndex >= 0) {
      result.splice(lastTaskLineIndex + 1, 0, `- [ ] ${taskTitle}`);
    }

    return result.join('\n');
  }

  private removeTaskFromContent(
    content: string,
    phaseTitle: string,
    milestoneTitle: string,
    taskIndex: number
  ): string {
    const lines = content.split(/\r?\n/);
    const result: string[] = [];
    let inTargetPhase = false;
    let inTargetMilestone = false;
    let currentTaskIndex = 0;

    for (const line of lines) {
      if (this.isPhaseHeader(line)) {
        inTargetPhase = line.includes(phaseTitle);
        inTargetMilestone = false;
        currentTaskIndex = 0;
      } else if (this.isMilestoneHeader(line) && inTargetPhase) {
        inTargetMilestone = line.includes(milestoneTitle);
        currentTaskIndex = 0;
      } else if (this.isTaskLine(line) && inTargetMilestone) {
        if (currentTaskIndex === taskIndex) {
          currentTaskIndex++;
          continue;
        }
        currentTaskIndex++;
      }

      result.push(line);
    }

    return result.join('\n');
  }

  private removeMilestoneFromContent(content: string, phaseTitle: string, milestoneTitle: string): string {
    const lines = content.split(/\r?\n/);
    const result: string[] = [];
    let inTargetPhase = false;
    let skipUntilNextSection = false;

    for (const line of lines) {
      if (this.isPhaseHeader(line)) {
        inTargetPhase = line.includes(phaseTitle);
        skipUntilNextSection = false;
      } else if (this.isMilestoneHeader(line)) {
        if (inTargetPhase && line.includes(milestoneTitle)) {
          skipUntilNextSection = true;
          continue;
        }
        skipUntilNextSection = false;
      }

      if (skipUntilNextSection) {
        continue;
      }

      result.push(line);
    }

    return this.cleanupEmptyLines(result.join('\n'));
  }

  private removePhaseFromContent(content: string, phaseTitle: string): string {
    const lines = content.split(/\r?\n/);
    const result: string[] = [];
    let skipUntilNextPhase = false;

    for (const line of lines) {
      if (this.isPhaseHeader(line)) {
        if (line.includes(phaseTitle)) {
          skipUntilNextPhase = true;
          continue;
        }
        skipUntilNextPhase = false;
      }

      if (skipUntilNextPhase) {
        continue;
      }

      result.push(line);
    }

    return this.cleanupEmptyLines(result.join('\n'));
  }

  private cleanupEmptyLines(content: string): string {
    return content.replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  private isPhaseHeader(line: string): boolean {
    return /^## Phase \d+:/.test(line);
  }

  private isMilestoneHeader(line: string): boolean {
    return /^### Milestone \d+\.\d+:/.test(line);
  }

  private isTaskLine(line: string): boolean {
    return /^- \[[ xX]\] .+$/.test(line);
  }
}

export class MarkdownRoadmapParser implements RoadmapParser {
  parse(content: string): ParsedRoadmap {
    const lines = content.split(/\r?\n/);
    const phases: RoadmapPhase[] = [];
    const context: ParserContext = {
      currentPhase: null,
      currentMilestone: null,
    };

    let seenFirstPhase = false;

    for (const line of lines) {
      if (!seenFirstPhase) {
        if (!this.parsePhaseHeader(line)) continue;
        seenFirstPhase = true;
      }

      this.processLine(line, phases, context);
    }

    return this.buildResult(phases);
  }

  private processLine(
    line: string,
    phases: RoadmapPhase[],
    context: ParserContext
  ): void {
    if (this.tryProcessPhase(line, phases, context)) return;
    if (this.tryProcessMilestone(line, context)) return;

    this.tryProcessTask(line, context);
  }

  private tryProcessPhase(
    line: string,
    phases: RoadmapPhase[],
    context: ParserContext
  ): boolean {
    const phaseMatch = this.parsePhaseHeader(line);

    if (!phaseMatch) return false;

    context.currentPhase = this.createPhase(phaseMatch);
    phases.push(context.currentPhase);
    context.currentMilestone = null;
    return true;
  }

  private tryProcessMilestone(line: string, context: ParserContext): boolean {
    const milestoneMatch = this.parseMilestoneHeader(line);

    if (!milestoneMatch || !context.currentPhase) return false;

    context.currentMilestone = this.createMilestone(milestoneMatch);
    context.currentPhase.milestones.push(context.currentMilestone);
    return true;
  }

  private tryProcessTask(line: string, context: ParserContext): void {
    const taskMatch = this.parseTask(line);

    if (!taskMatch || !context.currentMilestone) return;

    context.currentMilestone.tasks.push(taskMatch);
    context.currentMilestone.totalCount++;

    if (taskMatch.completed) {
      context.currentMilestone.completedCount++;
    }
  }

  private parsePhaseHeader(line: string): string | null {
    const match = line.match(/^## (Phase \d+:.*)$/);
    return match && match[1] ? match[1].trim() : null;
  }

  private parseMilestoneHeader(line: string): string | null {
    const match = line.match(/^### (Milestone \d+\.\d+:.*)$/);
    return match && match[1] ? match[1].trim() : null;
  }

  private parseTask(line: string): RoadmapTask | null {
    const match = line.match(/^- \[([ xX])\] (.+)$/);

    if (!match || !match[1] || !match[2]) {
      return null;
    }

    return {
      completed: match[1].toLowerCase() === 'x',
      title: match[2].trim(),
    };
  }

  private createPhase(title: string): RoadmapPhase {
    const idMatch = title.match(/Phase (\d+)/);
    const id = idMatch ? `phase-${idMatch[1]}` : `phase-${Date.now()}`;
    return { id, title, milestones: [] };
  }

  private createMilestone(title: string): RoadmapMilestone {
    const idMatch = title.match(/Milestone (\d+\.\d+)/);
    const id = idMatch ? `milestone-${idMatch[1]}` : `milestone-${Date.now()}`;
    return { id, title, tasks: [], completedCount: 0, totalCount: 0 };
  }

  private buildResult(phases: RoadmapPhase[]): ParsedRoadmap {
    let totalTasks = 0;
    let completedTasks = 0;
    let currentPhaseId: string | null = null;
    let currentMilestoneId: string | null = null;

    for (const phase of phases) {
      for (const milestone of phase.milestones) {
        totalTasks += milestone.totalCount;
        completedTasks += milestone.completedCount;

        if (!currentMilestoneId && milestone.completedCount < milestone.totalCount) {
          currentPhaseId = phase.id;
          currentMilestoneId = milestone.id;
        }
      }
    }

    const overallProgress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    return {
      phases,
      currentPhase: currentPhaseId,
      currentMilestone: currentMilestoneId,
      overallProgress,
    };
  }
}
