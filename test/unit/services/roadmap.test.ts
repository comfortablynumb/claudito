import {
  MarkdownRoadmapParser,
  MarkdownRoadmapEditor,
  RoadmapParser,
} from '../../../src/services/roadmap';

describe('MarkdownRoadmapParser', () => {
  let parser: RoadmapParser;

  beforeEach(() => {
    parser = new MarkdownRoadmapParser();
  });

  describe('parse', () => {
    it('should parse a simple roadmap', () => {
      const content = `# Roadmap

## Phase 1: Setup

### Milestone 1.1: Initial Setup
- [x] Task 1
- [ ] Task 2

### Milestone 1.2: Configuration
- [ ] Task 3

## Phase 2: Development

### Milestone 2.1: Core Features
- [ ] Task 4
- [ ] Task 5
`;

      const result = parser.parse(content);

      expect(result.phases).toHaveLength(2);
      expect(result.phases[0]!.id).toBe('phase-1');
      expect(result.phases[0]!.title).toBe('Phase 1: Setup');
      expect(result.phases[0]!.milestones).toHaveLength(2);
      expect(result.phases[0]!.milestones[0]!.tasks).toHaveLength(2);
      expect(result.phases[0]!.milestones[0]!.completedCount).toBe(1);
      expect(result.overallProgress).toBe(20); // 1 of 5 tasks completed
    });

    it('should handle empty content', () => {
      const result = parser.parse('');

      expect(result.phases).toHaveLength(0);
      expect(result.overallProgress).toBe(0);
    });

    it('should identify current phase and milestone', () => {
      const content = `## Phase 1: Setup
### Milestone 1.1: Init
- [x] Done task
- [ ] Pending task
`;
      const result = parser.parse(content);

      expect(result.currentPhase).toBe('phase-1');
      expect(result.currentMilestone).toBe('milestone-1.1');
    });

    it('should skip completed milestones when finding current', () => {
      const content = `## Phase 1: Setup
### Milestone 1.1: Init
- [x] Done 1
- [x] Done 2

### Milestone 1.2: Config
- [ ] Pending task
`;
      const result = parser.parse(content);

      expect(result.currentPhase).toBe('phase-1');
      expect(result.currentMilestone).toBe('milestone-1.2');
    });

    it('should return null current when all tasks are complete', () => {
      const content = `## Phase 1: Setup
### Milestone 1.1: Init
- [x] Done 1
- [x] Done 2
`;
      const result = parser.parse(content);

      expect(result.currentPhase).toBeNull();
      expect(result.currentMilestone).toBeNull();
      expect(result.overallProgress).toBe(100);
    });

    it('should handle content before first phase header', () => {
      const content = `# Project Roadmap
Some description text here

## Phase 1: Setup
### Milestone 1.1: Init
- [ ] Task 1
`;
      const result = parser.parse(content);

      expect(result.phases).toHaveLength(1);
      expect(result.phases[0]!.title).toBe('Phase 1: Setup');
    });

    it('should handle uppercase X in completed tasks', () => {
      const content = `## Phase 1: Setup
### Milestone 1.1: Init
- [X] Completed task
- [ ] Pending task
`;
      const result = parser.parse(content);

      expect(result.phases[0]!.milestones[0]!.completedCount).toBe(1);
      expect(result.phases[0]!.milestones[0]!.totalCount).toBe(2);
    });

    it('should ignore non-task lines', () => {
      const content = `## Phase 1: Setup
### Milestone 1.1: Init
- [x] Done task
Some random text
- [ ] Pending task
`;
      const result = parser.parse(content);

      expect(result.phases[0]!.milestones[0]!.tasks).toHaveLength(2);
    });

    it('should handle tasks without a milestone', () => {
      const content = `## Phase 1: Setup
- [ ] Orphan task
### Milestone 1.1: Init
- [ ] Real task
`;
      const result = parser.parse(content);

      // The orphan task should be ignored (no current milestone)
      expect(result.phases[0]!.milestones).toHaveLength(1);
      expect(result.phases[0]!.milestones[0]!.tasks).toHaveLength(1);
    });

    it('should handle milestone without a phase', () => {
      const content = `### Milestone 1.1: Init
- [ ] Task 1
`;
      const result = parser.parse(content);

      // No phase seen, so milestone is ignored
      expect(result.phases).toHaveLength(0);
    });
  });
});

describe('MarkdownRoadmapEditor - deleteTask edge cases', () => {
  let parser: RoadmapParser;
  let editor: MarkdownRoadmapEditor;

  beforeEach(() => {
    parser = new MarkdownRoadmapParser();
    editor = new MarkdownRoadmapEditor(parser);
  });

  it('should delete the first task', () => {
    const content = `## Phase 1: Setup
### Milestone 1.1: Init
- [x] First task
- [ ] Second task
`;
    const result = editor.deleteTask(content, {
      phaseId: 'phase-1',
      milestoneId: 'milestone-1.1',
      taskIndex: 0,
    });

    expect(result).not.toContain('First task');
    expect(result).toContain('Second task');
  });

  it('should delete the last task', () => {
    const content = `## Phase 1: Setup
### Milestone 1.1: Init
- [x] First task
- [ ] Second task
`;
    const result = editor.deleteTask(content, {
      phaseId: 'phase-1',
      milestoneId: 'milestone-1.1',
      taskIndex: 1,
    });

    expect(result).toContain('First task');
    expect(result).not.toContain('Second task');
  });

  it('should throw for negative task index', () => {
    const content = `## Phase 1: Setup
### Milestone 1.1: Init
- [ ] Task 1
`;
    expect(() =>
      editor.deleteTask(content, {
        phaseId: 'phase-1',
        milestoneId: 'milestone-1.1',
        taskIndex: -1,
      })
    ).toThrow('Invalid task index: -1');
  });
});

describe('MarkdownRoadmapEditor', () => {
  let parser: RoadmapParser;
  let editor: MarkdownRoadmapEditor;

  beforeEach(() => {
    parser = new MarkdownRoadmapParser();
    editor = new MarkdownRoadmapEditor(parser);
  });

  const sampleRoadmap = `# Project Roadmap

## Phase 1: Foundation

### Milestone 1.1: Setup
- [x] Initialize project
- [ ] Configure linting
- [ ] Setup testing

### Milestone 1.2: Core Structure
- [ ] Create folder structure
- [ ] Setup routing

## Phase 2: Features

### Milestone 2.1: User Management
- [ ] User registration
- [ ] User login
- [ ] User profile

## Phase 3: Polish

### Milestone 3.1: Cleanup
- [ ] Code review
- [ ] Documentation
`;

  describe('deleteTask', () => {
    it('should delete a specific task by index', () => {
      const result = editor.deleteTask(sampleRoadmap, {
        phaseId: 'phase-1',
        milestoneId: 'milestone-1.1',
        taskIndex: 1,
      });

      expect(result).not.toContain('Configure linting');
      expect(result).toContain('Initialize project');
      expect(result).toContain('Setup testing');
    });

    it('should throw error for invalid phase', () => {
      expect(() =>
        editor.deleteTask(sampleRoadmap, {
          phaseId: 'phase-99',
          milestoneId: 'milestone-1.1',
          taskIndex: 0,
        })
      ).toThrow('Phase not found: phase-99');
    });

    it('should throw error for invalid milestone', () => {
      expect(() =>
        editor.deleteTask(sampleRoadmap, {
          phaseId: 'phase-1',
          milestoneId: 'milestone-99.99',
          taskIndex: 0,
        })
      ).toThrow('Milestone not found: milestone-99.99');
    });

    it('should throw error for invalid task index', () => {
      expect(() =>
        editor.deleteTask(sampleRoadmap, {
          phaseId: 'phase-1',
          milestoneId: 'milestone-1.1',
          taskIndex: 99,
        })
      ).toThrow('Invalid task index: 99');
    });
  });

  describe('deleteMilestone', () => {
    it('should delete an entire milestone with all its tasks', () => {
      const result = editor.deleteMilestone(sampleRoadmap, {
        phaseId: 'phase-1',
        milestoneId: 'milestone-1.1',
      });

      expect(result).not.toContain('Milestone 1.1: Setup');
      expect(result).not.toContain('Initialize project');
      expect(result).not.toContain('Configure linting');
      expect(result).not.toContain('Setup testing');
      expect(result).toContain('Milestone 1.2: Core Structure');
      expect(result).toContain('Phase 1: Foundation');
    });

    it('should delete a milestone without affecting other phases', () => {
      const result = editor.deleteMilestone(sampleRoadmap, {
        phaseId: 'phase-2',
        milestoneId: 'milestone-2.1',
      });

      expect(result).not.toContain('Milestone 2.1: User Management');
      expect(result).not.toContain('User registration');
      expect(result).toContain('Phase 1: Foundation');
      expect(result).toContain('Milestone 1.1: Setup');
      expect(result).toContain('Phase 3: Polish');
    });

    it('should throw error for invalid phase', () => {
      expect(() =>
        editor.deleteMilestone(sampleRoadmap, {
          phaseId: 'phase-99',
          milestoneId: 'milestone-1.1',
        })
      ).toThrow('Phase not found: phase-99');
    });

    it('should throw error for invalid milestone', () => {
      expect(() =>
        editor.deleteMilestone(sampleRoadmap, {
          phaseId: 'phase-1',
          milestoneId: 'milestone-99.99',
        })
      ).toThrow('Milestone not found: milestone-99.99');
    });
  });

  describe('deletePhase', () => {
    it('should delete an entire phase with all milestones and tasks', () => {
      const result = editor.deletePhase(sampleRoadmap, {
        phaseId: 'phase-1',
      });

      expect(result).not.toContain('Phase 1: Foundation');
      expect(result).not.toContain('Milestone 1.1: Setup');
      expect(result).not.toContain('Milestone 1.2: Core Structure');
      expect(result).not.toContain('Initialize project');
      expect(result).toContain('Phase 2: Features');
      expect(result).toContain('Phase 3: Polish');
    });

    it('should delete a middle phase without affecting others', () => {
      const result = editor.deletePhase(sampleRoadmap, {
        phaseId: 'phase-2',
      });

      expect(result).not.toContain('Phase 2: Features');
      expect(result).not.toContain('Milestone 2.1: User Management');
      expect(result).not.toContain('User registration');
      expect(result).toContain('Phase 1: Foundation');
      expect(result).toContain('Phase 3: Polish');
    });

    it('should delete the last phase', () => {
      const result = editor.deletePhase(sampleRoadmap, {
        phaseId: 'phase-3',
      });

      expect(result).not.toContain('Phase 3: Polish');
      expect(result).not.toContain('Milestone 3.1: Cleanup');
      expect(result).toContain('Phase 1: Foundation');
      expect(result).toContain('Phase 2: Features');
    });

    it('should throw error for invalid phase', () => {
      expect(() =>
        editor.deletePhase(sampleRoadmap, {
          phaseId: 'phase-99',
        })
      ).toThrow('Phase not found: phase-99');
    });

    it('should handle deleting all phases', () => {
      let result = editor.deletePhase(sampleRoadmap, { phaseId: 'phase-1' });
      result = editor.deletePhase(result, { phaseId: 'phase-2' });
      result = editor.deletePhase(result, { phaseId: 'phase-3' });

      expect(result.trim()).toBe('# Project Roadmap');
    });
  });

  describe('addTask', () => {
    it('should add a task to the end of a milestone', () => {
      const result = editor.addTask(sampleRoadmap, {
        phaseId: 'phase-1',
        milestoneId: 'milestone-1.1',
        taskTitle: 'New task added',
      });

      expect(result).toContain('- [ ] New task added');
      // The new task should appear after the last task in milestone 1.1
      const lines = result.split('\n');
      const setupTestingIdx = lines.findIndex(l => l.includes('Setup testing'));
      const newTaskIdx = lines.findIndex(l => l.includes('New task added'));
      expect(newTaskIdx).toBe(setupTestingIdx + 1);
    });

    it('should add a task to a different milestone', () => {
      const result = editor.addTask(sampleRoadmap, {
        phaseId: 'phase-2',
        milestoneId: 'milestone-2.1',
        taskTitle: 'User deletion',
      });

      expect(result).toContain('- [ ] User deletion');
      const lines = result.split('\n');
      const profileIdx = lines.findIndex(l => l.includes('User profile'));
      const newIdx = lines.findIndex(l => l.includes('User deletion'));
      expect(newIdx).toBe(profileIdx + 1);
    });

    it('should throw error for invalid phase', () => {
      expect(() =>
        editor.addTask(sampleRoadmap, {
          phaseId: 'phase-99',
          milestoneId: 'milestone-1.1',
          taskTitle: 'Test',
        })
      ).toThrow('Phase not found: phase-99');
    });

    it('should throw error for invalid milestone', () => {
      expect(() =>
        editor.addTask(sampleRoadmap, {
          phaseId: 'phase-1',
          milestoneId: 'milestone-99.99',
          taskTitle: 'Test',
        })
      ).toThrow('Milestone not found: milestone-99.99');
    });

    it('should add a task to the last milestone at end of content', () => {
      const result = editor.addTask(sampleRoadmap, {
        phaseId: 'phase-3',
        milestoneId: 'milestone-3.1',
        taskTitle: 'Final cleanup',
      });

      expect(result).toContain('- [ ] Final cleanup');
      const lines = result.split('\n');
      const docIdx = lines.findIndex(l => l.includes('Documentation'));
      const newIdx = lines.findIndex(l => l.includes('Final cleanup'));
      expect(newIdx).toBe(docIdx + 1);
    });

    it('should add task when next milestone header comes before phase end', () => {
      // Add task to milestone 1.1 which is followed by milestone 1.2
      const result = editor.addTask(sampleRoadmap, {
        phaseId: 'phase-1',
        milestoneId: 'milestone-1.1',
        taskTitle: 'Between milestones',
      });

      expect(result).toContain('- [ ] Between milestones');
      const lines = result.split('\n');
      const setupIdx = lines.findIndex(l => l.includes('Setup testing'));
      const newIdx = lines.findIndex(l => l.includes('Between milestones'));
      expect(newIdx).toBe(setupIdx + 1);
      // Ensure the task appears before milestone 1.2
      const milestone12Idx = lines.findIndex(l => l.includes('Milestone 1.2'));
      expect(newIdx).toBeLessThan(milestone12Idx);
    });

    it('should add task when next phase header comes', () => {
      // Add task to milestone 1.2 (last milestone of phase 1, followed by phase 2)
      const result = editor.addTask(sampleRoadmap, {
        phaseId: 'phase-1',
        milestoneId: 'milestone-1.2',
        taskTitle: 'Phase boundary task',
      });

      expect(result).toContain('- [ ] Phase boundary task');
      const lines = result.split('\n');
      const routingIdx = lines.findIndex(l => l.includes('Setup routing'));
      const newIdx = lines.findIndex(l => l.includes('Phase boundary task'));
      expect(newIdx).toBe(routingIdx + 1);
      // Ensure the task appears before phase 2
      const phase2Idx = lines.findIndex(l => l.includes('Phase 2: Features'));
      expect(newIdx).toBeLessThan(phase2Idx);
    });

    it('should preserve existing content', () => {
      const result = editor.addTask(sampleRoadmap, {
        phaseId: 'phase-1',
        milestoneId: 'milestone-1.1',
        taskTitle: 'Extra task',
      });

      expect(result).toContain('Initialize project');
      expect(result).toContain('Configure linting');
      expect(result).toContain('Setup testing');
      expect(result).toContain('Phase 2: Features');
      expect(result).toContain('Phase 3: Polish');
    });
  });
});
