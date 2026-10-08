import { StudioHistoryService, StudioHistorySnapshot } from './studio-history.service';

describe('Downloaded history checkpoint',()=>{
 const before: StudioHistorySnapshot={pages:[],objects:[],currentPage:1,watermark:null};
 const after: StudioHistorySnapshot={...before,pages:[{id:'one',kind:'blank',sourcePageNumber:null,rotation:0,blankWidth:600,blankHeight:800}]};
 it('tracks undo, redo and a new branch independently of stack length',()=>{
   const history=new StudioHistoryService();history.reset();
   expect(history.hasUnsavedChanges()).toBe(false);
   history.record('Add page',before,after);expect(history.hasUnsavedChanges()).toBe(true);
   history.markDownloaded(history.revision());expect(history.hasUnsavedChanges()).toBe(false);
   history.undo();expect(history.hasUnsavedChanges()).toBe(true);
   history.redo();expect(history.hasUnsavedChanges()).toBe(false);
   history.undo();history.record('Another edit',before,after);expect(history.hasUnsavedChanges()).toBe(true);
 });
 it('does not mark later edits as downloaded by an older prepared export',()=>{
   const history=new StudioHistoryService();history.record('Add',before,after);const exported=history.revision();
   history.record('Remove',after,before);history.markDownloaded(exported);expect(history.hasUnsavedChanges()).toBe(true);
 });
});
