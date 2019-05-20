import { Card, Button, message, Input, Divider } from 'antd';
import { hot } from 'react-hot-loader'; // needs to be before react!
import * as React from 'react';
import { EnvVarRecord } from '@src/generated';
import * as jsforce from 'jsforce';
import { DEFAULT_CONFIG } from 'ts-force/build/auth/baseConfig';
import { EnvVarItem } from './components/EnvItem';
import { EnvVar, DataType, MetadataResult } from './types';
import { EnvGroup } from './components/EnvGroup';
import { TableOfContents } from './components/tableOfContents';

const ENV_PREFIX = EnvVarRecord.API_NAME.replace('__mdt', '');

interface AppState {
  vars: EnvVar[];
  groups: string[];
  filter?: string;
}

class App extends React.Component<{}, AppState> {
  private mdapi: jsforce.Metadata;
  private draggedItem: EnvVar;
  constructor(props: any) {
    super(props);
    this.state = {
      vars: [],
      groups: [''],
    };
  }

  // RETRIEVE METADATA
  public async componentDidMount() {
    const conn = new jsforce.Connection({
      accessToken: DEFAULT_CONFIG.accessToken,
    });
    this.mdapi = conn.metadata;
    const varsRecords = await EnvVarRecord.retrieve((fields) => {
      return {
        select: fields.select('id', 'developerName', 'datatype', 'value', 'group', 'notes'),
      };
    });
    if (varsRecords.length > 0) {
      const groups = varsRecords.reduce((groups, vRec) => {
        const group = vRec.group || '';
        if (!groups.includes(group)) {
          groups.push(group);
        }
        return groups;
      }, []);
      const vars = varsRecords.map<EnvVar>((vRec) => {
        const {developerName: key, value, datatype, group, notes } = vRec;
        const dataType = datatype as DataType;
        return {
          key,
          value,
          dataType,
          group: group || '',
          notes,
        };
      });
      if (!groups.includes('')) {
        groups.push('');
      }
      this.setState({ vars, groups });
    }
  }

  // Drag & Drop
  private handleDragStart = (e: any, item: EnvVar) => {
    this.draggedItem = item;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', e.target.parentNode);
    e.dataTransfer.setDragImage(e.target.parentNode, 20, 20);
  }

  public handleDragOver = (draggedOverItem: EnvVar) => {

    // if the item is dragged over itself, ignore
    if (this.draggedItem === draggedOverItem) {
      return;
    }

    const index = this.state.vars.findIndex((v) => v === draggedOverItem);
    const vars = this.state.vars.filter((v) => v !== this.draggedItem);
    const newDraggedItem = { ...this.draggedItem };
    this.draggedItem = newDraggedItem;
    if (this.draggedItem.group !== draggedOverItem.group) {
      newDraggedItem.group = draggedOverItem.group;
      newDraggedItem.hasChanges = true;
    }
    vars.splice(index, 0, newDraggedItem);
    this.setState({ vars });
  }

  public handleDragEnd = () => {
    this.draggedItem = null;
  }

  public handleDragOverNoGroup = (group: string) => {
    const index = this.state.vars.findIndex((v) => v === this.draggedItem);
    const newDraggedItem = { ...this.draggedItem };
    this.draggedItem = newDraggedItem;
    if (this.draggedItem.group !== group) {
      newDraggedItem.group = group;
      newDraggedItem.hasChanges = true;
    }
    const vars = [...this.state.vars];
    vars[index] = newDraggedItem;
    const groups = [...this.state.groups];
    this.setState({vars, groups});
  }

  public newGroup = () => {
    const groups = [...this.state.groups];
    groups.push(undefined);
    this.setState({groups});
  }

  public cancelNewGroup = () => {
    const groups = this.state.groups.filter((g) => g !== undefined);
    this.setState({groups});
  }

  // === LOCAL STATE HANDLERS===

  private updateVar = (item: EnvVar, field: keyof EnvVar, val: string) => {
    const index = this.state.vars.findIndex((v) => v === item);
    const vars = [...this.state.vars];
    vars[index] = { ...item, ...{ [field]: val, hasChanges: true } };
    this.setState({ vars });
  }

  private addNew = () => {
    const vars = [...this.state.vars];
    vars.push({
      dataType: 'String',
      localOnly: true,
      group: '',
      notes: '',
      value: '',
    });
    this.setState({ vars });
  }

  // === DML HANDLERS ===

  private updateGroupName = async (oldName: string, newName: string) => {
    const gIndex = this.state.groups.indexOf(oldName);
    const groups = [...this.state.groups];
    groups[gIndex] = newName;

    const vars: EnvVar[] = [];
    for (const v of this.state.vars) {
      if (v.group === oldName) {
        const payload = {
          fullName: `${ENV_PREFIX}.${v.key}`,
          label: v.key,
          values: [
            { field: EnvVarRecord.FIELDS['group'].apiName, value: newName },
          ],
        } as jsforce.MetadataInfo;
        const result = await this.mdapi.update('CustomMetadata', payload) as any as MetadataResult;
        if (!result.success) {
          console.log('Failed to change group', v, newName);
        }
        vars.push({...v, ...{group: newName}});
      }
      vars.push(v);
    }

    // make sure we always have an empty group
    if (!groups.includes('')) {
      groups.push('');
    }
    this.setState({vars, groups});
  }

  private saveVar = async (item: EnvVar) => {

    const index = this.state.vars.findIndex((v) => v === item);

    // tslint:disable-next-line: no-object-literal-type-assertion
    const val = item.value.slice(0, Math.min(255, item.value.length));
    const payload: jsforce.MetadataInfo = {
      fullName: `${ENV_PREFIX}.${item.key}`,
      label: item.key,
      values: [
        { field: EnvVarRecord.FIELDS['value'].apiName, value: item.value },
        { field: EnvVarRecord.FIELDS['val'].apiName, value:  val},
        { field: EnvVarRecord.FIELDS['datatype'].apiName, value: item.dataType },
        { field: EnvVarRecord.FIELDS['group'].apiName, value: item.group },
        { field: EnvVarRecord.FIELDS['notes'].apiName, value: item.notes },
      ],
    } as jsforce.MetadataInfo;

    let result: MetadataResult;
    if (item.localOnly) {
      result = await this.mdapi.create('CustomMetadata', payload) as any as MetadataResult;
    } else {
      result = await this.mdapi.update('CustomMetadata', payload) as any as MetadataResult;
    }
    let newVar: Partial<EnvVar>;
    if (result.success) {
      newVar = { hasChanges: false, localOnly: false, dmlError: false };
    } else {
      newVar = { dmlError: true };
      message.error(result.errors.message);
    }

    const vars = [...this.state.vars];
    vars[index] = { ...item, ...newVar };
    this.setState({ vars });
  }

  private removeVar = async (item: EnvVar) => {
    const index = this.state.vars.findIndex((v) => v === item);

    if (!item.localOnly) {
      const result = await this.mdapi.delete(
        'CustomMetadata',
        `${ENV_PREFIX}.${item.key}`,
      ) as any as MetadataResult;

      if (!result.success) {
        message.error(result.errors.message);
        return;
      }
    }
    const vars = this.state.vars.filter((_, i) => i !== index);
    this.setState({ vars });
  }

  // === RENDER ===

  public render() {
    const vars = this.filterVars();

    const groupVars: {[key: string]: JSX.Element[]} = {};
    for (const group of this.state.groups) {
      const gVars = vars.filter((v) => v.group === group);

      groupVars[group] = gVars.map((v, i) => {
        return (
          <EnvVarItem
            key={i}
            item={v}
            onRemove={this.removeVar}
            onSave={this.saveVar}
            onUpdate={this.updateVar}
            onDragEnd={this.handleDragEnd}
            onDragOver={this.handleDragOver}
            onDragStart={this.handleDragStart}
          />
        );
      });
    }

    const groupElements = [];
    for (const groupKey of Object.keys(groupVars).sort()) {
      let group = groupKey;
      if (group === 'undefined') {
        group = undefined; // yuck
      }
      groupElements.push((
        <EnvGroup
          key={groupKey}
          group={group}
          items={groupVars[group]}
          onCancel={this.cancelNewGroup}
          onDragOverEmptyGroup={this.handleDragOverNoGroup}
          onGroupNameSubmit={this.updateGroupName}
        />
      ));
    }

    const toc = (
      <TableOfContents
        onTitleClick={(key) => this.setState({filter: key})}
        vars={this.state.vars}
      />
    );

    return (
      <Card
        title='Enviroment Variables'
        extra={toc}
      >
        <Input.Search
          placeholder='Search Keys or Values'
          value={this.state.filter}
          onChange={(e) => this.setState({filter: e.target.value})}
          allowClear={true}
          style={{width: '35%'}}
        />
        <Button style={{ marginLeft: 10 }} icon='folder' onClick={() => this.newGroup()}>Add Group</Button>
        <Divider dashed={true} />
        {groupElements}
        <Button style={{ marginTop: 15 }} type='primary' icon='plus' onClick={this.addNew}>Add</Button>
      </Card>
    );
  }

  private filterVars() {
    let vars = this.state.vars;
    if (this.state.filter) {
      const filter = this.state.filter.toLocaleLowerCase();
      vars = vars.filter((v) => {
        return v.key && v.key.toLocaleLowerCase().includes(filter)
          || v.value && v.value.toLocaleLowerCase().includes(filter);
      })
    }
    return vars;
  }

}

export default hot(module)(App);
