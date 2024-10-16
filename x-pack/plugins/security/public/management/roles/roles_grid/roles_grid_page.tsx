/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { EuiBasicTableColumn, EuiSwitchEvent } from '@elastic/eui';
import {
  EuiButton,
  EuiButtonEmpty,
  EuiFlexGroup,
  EuiFlexItem,
  EuiInMemoryTable,
  EuiLink,
  EuiPageHeader,
  EuiSpacer,
  EuiSwitch,
  EuiText,
  EuiToolTip,
} from '@elastic/eui';
import _ from 'lodash';
import React, { Component } from 'react';

import type { BuildFlavor } from '@kbn/config';
import type { I18nStart, NotificationsStart, ScopedHistory } from '@kbn/core/public';
import { i18n } from '@kbn/i18n';
import { FormattedMessage } from '@kbn/i18n-react';
import { reactRouterNavigate } from '@kbn/kibana-react-plugin/public';
import type { ThemeServiceStart } from '@kbn/react-kibana-context-common';
import type { PublicMethodsOf } from '@kbn/utility-types';

import { ConfirmDelete } from './confirm_delete';
import { PermissionDenied } from './permission_denied';
import type { Role } from '../../../../common';
import {
  getExtendedRoleDeprecationNotice,
  isRoleDeprecated,
  isRoleEnabled,
  isRoleReadOnly,
  isRoleReserved,
} from '../../../../common/model';
import { DeprecatedBadge, DisabledBadge, ReservedBadge } from '../../badges';
import { ActionsEuiTableFormatting } from '../../table_utils';
import type { RolesAPIClient } from '../roles_api_client';

interface Props {
  notifications: NotificationsStart;
  rolesAPIClient: PublicMethodsOf<RolesAPIClient>;
  history: ScopedHistory;
  readOnly?: boolean;
  buildFlavor: BuildFlavor;
  theme: ThemeServiceStart;
  i18nStart: I18nStart;
  cloudOrgUrl?: string;
}

interface State {
  roles: Role[];
  visibleRoles: Role[];
  selection: Role[];
  filter: string;
  showDeleteConfirmation: boolean;
  permissionDenied: boolean;
  includeReservedRoles: boolean;
  isLoading: boolean;
}

const getRoleManagementHref = (action: 'edit' | 'clone', roleName?: string) => {
  return `/${action}${roleName ? `/${encodeURIComponent(roleName)}` : ''}`;
};

export class RolesGridPage extends Component<Props, State> {
  static defaultProps: Partial<Props> = {
    readOnly: false,
  };

  constructor(props: Props) {
    super(props);
    this.state = {
      roles: [],
      visibleRoles: [],
      selection: [],
      filter: '',
      showDeleteConfirmation: false,
      permissionDenied: false,
      includeReservedRoles: true,
      isLoading: false,
    };
  }

  public componentDidMount() {
    this.loadRoles();
  }

  public render() {
    const { permissionDenied } = this.state;

    return permissionDenied ? <PermissionDenied /> : this.getPageContent();
  }

  private getPageContent = () => {
    const { isLoading } = this.state;

    const customRolesEnabled = this.props.buildFlavor === 'serverless';

    const rolesTitle = customRolesEnabled ? (
      <FormattedMessage
        id="xpack.security.management.roles.customRoleTitle"
        defaultMessage="Custom Roles"
      />
    ) : (
      <FormattedMessage id="xpack.security.management.roles.roleTitle" defaultMessage="Roles" />
    );

    const rolesDescription = customRolesEnabled ? (
      <FormattedMessage
        id="xpack.security.management.roles.customRolesSubtitle"
        defaultMessage="In addition to the predefined roles on the system, you can create your own roles and provide your users with the exact set of privileges that they need."
      />
    ) : (
      <FormattedMessage
        id="xpack.security.management.roles.subtitle"
        defaultMessage="Apply roles to groups of users and manage permissions across the stack."
      />
    );

    const emptyResultsMessage = customRolesEnabled ? (
      <FormattedMessage
        id="xpack.security.management.roles.noCustomRolesFound"
        defaultMessage="No custom roles to show"
      />
    ) : (
      <FormattedMessage
        id="xpack.security.management.roles.noRolesFound"
        defaultMessage="No items found"
      />
    );
    const pageRightSideItems = [
      <EuiButton
        data-test-subj="createRoleButton"
        {...reactRouterNavigate(this.props.history, getRoleManagementHref('edit'))}
        fill
        iconType="plusInCircleFilled"
      >
        <FormattedMessage
          id="xpack.security.management.roles.createRoleButtonLabel"
          defaultMessage="Create role"
        />
      </EuiButton>,
    ];
    if (customRolesEnabled) {
      pageRightSideItems.push(
        <EuiButtonEmpty
          href={this.props.cloudOrgUrl}
          target="_blank"
          iconSide="right"
          iconType="popout"
        >
          <FormattedMessage
            id="xpack.security.management.roles.assignRolesLinkLabel"
            defaultMessage="Assign roles"
          />
        </EuiButtonEmpty>
      );
    }
    return (
      <>
        <EuiPageHeader
          bottomBorder
          pageTitle={rolesTitle}
          description={rolesDescription}
          rightSideItems={this.props.readOnly ? undefined : pageRightSideItems}
        />

        <EuiSpacer size="l" />

        {this.state.showDeleteConfirmation ? (
          <ConfirmDelete
            onCancel={this.onCancelDelete}
            rolesToDelete={this.state.selection.map((role) => role.name)}
            callback={this.handleDelete}
            notifications={this.props.notifications}
            rolesAPIClient={this.props.rolesAPIClient}
            buildFlavor={this.props.buildFlavor}
            theme={this.props.theme}
            i18nStart={this.props.i18nStart}
            cloudOrgUrl={this.props.cloudOrgUrl}
          />
        ) : null}

        <ActionsEuiTableFormatting>
          <EuiInMemoryTable
            itemId="name"
            responsive={false}
            columns={this.getColumnConfig()}
            hasActions={true}
            selection={
              this.props.readOnly
                ? undefined
                : {
                    selectable: (role: Role) => !role.metadata || !role.metadata._reserved,
                    selectableMessage: (selectable: boolean) =>
                      !selectable ? 'Role is reserved' : '',
                    onSelectionChange: (selection: Role[]) => this.setState({ selection }),
                    selected: this.state.selection,
                  }
            }
            pagination={{
              initialPageSize: 20,
              pageSizeOptions: [10, 20, 30, 50, 100],
            }}
            message={emptyResultsMessage}
            items={this.state.visibleRoles}
            loading={isLoading}
            search={{
              toolsLeft: this.renderToolsLeft(),
              toolsRight: this.renderToolsRight(),
              box: {
                incremental: true,
                'data-test-subj': 'searchRoles',
              },
              onChange: (query: Record<string, any>) => {
                this.setState({
                  filter: query.queryText,
                  visibleRoles: this.getVisibleRoles(
                    this.state.roles,
                    query.queryText,
                    this.state.includeReservedRoles
                  ),
                });
              },
            }}
            sorting={{
              sort: {
                field: 'name',
                direction: 'asc',
              },
            }}
            rowProps={(role: Role) => {
              return {
                'data-test-subj': `roleRow`,
              };
            }}
            isSelectable
          />
        </ActionsEuiTableFormatting>
      </>
    );
  };

  private getColumnConfig = () => {
    const config: Array<EuiBasicTableColumn<Role>> = [
      {
        field: 'name',
        name: i18n.translate('xpack.security.management.roles.nameColumnName', {
          defaultMessage: 'Role',
        }),
        sortable: true,
        render: (name: string, record: Role) => {
          return (
            <EuiText color="subdued" size="s">
              <EuiLink
                data-test-subj="roleRowName"
                {...reactRouterNavigate(this.props.history, getRoleManagementHref('edit', name))}
              >
                {name}
              </EuiLink>
            </EuiText>
          );
        },
      },
    ];
    if (this.props.buildFlavor !== 'serverless') {
      config.push({
        field: 'metadata',
        name: i18n.translate('xpack.security.management.roles.statusColumnName', {
          defaultMessage: 'Status',
        }),
        sortable: (role: Role) => isRoleEnabled(role) && !isRoleDeprecated(role),
        render: (metadata: Role['metadata'], record: Role) => {
          return this.getRoleStatusBadges(record);
        },
      });
    }

    if (!this.props.readOnly) {
      config.push({
        name: i18n.translate('xpack.security.management.roles.actionsColumnName', {
          defaultMessage: 'Actions',
        }),
        width: '150px',
        actions: [
          {
            available: (role: Role) => !isRoleReserved(role),
            isPrimary: true,
            render: (role: Role) => {
              const title = i18n.translate('xpack.security.management.roles.cloneRoleActionName', {
                defaultMessage: `Clone`,
              });

              const label = i18n.translate('xpack.security.management.roles.cloneRoleActionLabel', {
                defaultMessage: `Clone {roleName}`,
                values: { roleName: role.name },
              });

              return (
                <EuiToolTip content={title}>
                  <EuiButtonEmpty
                    aria-label={label}
                    color={'primary'}
                    data-test-subj={`clone-role-action-${role.name}`}
                    disabled={this.state.selection.length >= 1}
                    iconType={'copy'}
                    {...reactRouterNavigate(
                      this.props.history,
                      getRoleManagementHref('clone', role.name)
                    )}
                  >
                    {title}
                  </EuiButtonEmpty>
                </EuiToolTip>
              );
            },
          },
          {
            available: (role: Role) => !role.metadata || !role.metadata._reserved,
            render: (role: Role) => {
              const title = i18n.translate('xpack.security.management.roles.deleteRoleActionName', {
                defaultMessage: `Delete`,
              });

              const label = i18n.translate(
                'xpack.security.management.roles.deleteRoleActionLabel',
                {
                  defaultMessage: `Delete {roleName}`,
                  values: { roleName: role.name },
                }
              );

              return (
                <EuiToolTip content={title}>
                  <EuiButtonEmpty
                    aria-label={label}
                    color={'danger'}
                    data-test-subj={`delete-role-action-${role.name}`}
                    disabled={this.state.selection.length >= 1}
                    iconType={'trash'}
                    onClick={() => this.deleteOneRole(role)}
                  >
                    {title}
                  </EuiButtonEmpty>
                </EuiToolTip>
              );
            },
          },
          {
            available: (role: Role) => !isRoleReadOnly(role),
            enabled: () => this.state.selection.length === 0,
            isPrimary: true,
            render: (role: Role) => {
              const title = i18n.translate('xpack.security.management.roles.editRoleActionName', {
                defaultMessage: `Edit`,
              });

              const label = i18n.translate('xpack.security.management.roles.editRoleActionLabel', {
                defaultMessage: `Edit {roleName}`,
                values: { roleName: role.name },
              });

              return (
                <EuiToolTip content={title}>
                  <EuiButtonEmpty
                    aria-label={label}
                    color={'primary'}
                    data-test-subj={`edit-role-action-${role.name}`}
                    disabled={this.state.selection.length >= 1}
                    iconType={'pencil'}
                    {...reactRouterNavigate(
                      this.props.history,
                      getRoleManagementHref('edit', role.name)
                    )}
                  >
                    {title}
                  </EuiButtonEmpty>
                </EuiToolTip>
              );
            },
          },
        ],
      });
    }

    return config;
  };

  private getVisibleRoles = (roles: Role[], filter: string, includeReservedRoles: boolean) => {
    return roles.filter((role) => {
      const normalized = `${role.name}`.toLowerCase();
      const normalizedQuery = filter.toLowerCase();
      return (
        normalized.indexOf(normalizedQuery) !== -1 &&
        (includeReservedRoles || !isRoleReserved(role))
      );
    });
  };

  private onIncludeReservedRolesChange = (e: EuiSwitchEvent) => {
    this.setState({
      includeReservedRoles: e.target.checked,
      visibleRoles: this.getVisibleRoles(this.state.roles, this.state.filter, e.target.checked),
    });
  };

  private getRoleStatusBadges = (role: Role) => {
    const enabled = isRoleEnabled(role);
    const deprecated = isRoleDeprecated(role);
    const reserved = isRoleReserved(role);

    const badges: JSX.Element[] = [];
    if (!enabled) {
      badges.push(<DisabledBadge data-test-subj="roleDisabled" />);
    }
    if (reserved) {
      badges.push(
        <ReservedBadge
          data-test-subj="roleReserved"
          tooltipContent={
            <FormattedMessage
              id="xpack.security.management.roles.reservedRoleBadgeTooltip"
              defaultMessage="Reserved roles are built-in and cannot be edited or removed."
            />
          }
        />
      );
    }
    if (deprecated) {
      badges.push(
        <DeprecatedBadge
          data-test-subj="roleDeprecated"
          tooltipContent={getExtendedRoleDeprecationNotice(role)}
        />
      );
    }

    return (
      <EuiFlexGroup gutterSize="s">
        {badges.map((badge, index) => (
          <EuiFlexItem key={index} grow={false}>
            {badge}
          </EuiFlexItem>
        ))}
      </EuiFlexGroup>
    );
  };

  private handleDelete = () => {
    this.setState({
      selection: [],
      showDeleteConfirmation: false,
    });
    this.loadRoles();
  };

  private deleteOneRole = (roleToDelete: Role) => {
    this.setState({
      selection: [roleToDelete],
      showDeleteConfirmation: true,
    });
  };

  private async loadRoles() {
    try {
      this.setState({ isLoading: true });
      const roles = await this.props.rolesAPIClient.getRoles();

      this.setState({
        roles,
        visibleRoles: this.getVisibleRoles(
          roles,
          this.state.filter,
          this.state.includeReservedRoles
        ),
      });
    } catch (e) {
      if (_.get(e, 'body.statusCode') === 403) {
        this.setState({ permissionDenied: true });
      } else {
        this.props.notifications.toasts.addDanger(
          i18n.translate('xpack.security.management.roles.fetchingRolesErrorMessage', {
            defaultMessage: 'Error fetching roles: {message}',
            values: { message: _.get(e, 'body.message', '') },
          })
        );
      }
    } finally {
      this.setState({ isLoading: false });
    }
  }

  private renderToolsLeft() {
    const { selection } = this.state;
    if (selection.length === 0) {
      return;
    }
    const numSelected = selection.length;
    return (
      <EuiButton
        data-test-subj="deleteRoleButton"
        color="danger"
        onClick={() => this.setState({ showDeleteConfirmation: true })}
      >
        <FormattedMessage
          id="xpack.security.management.roles.deleteSelectedRolesButtonLabel"
          defaultMessage="Delete {numSelected} role{numSelected, plural, one { } other {s}}"
          values={{
            numSelected,
          }}
        />
      </EuiButton>
    );
  }

  private renderToolsRight() {
    if (this.props.buildFlavor !== 'serverless') {
      return (
        <EuiSwitch
          data-test-subj="showReservedRolesSwitch"
          label={
            <FormattedMessage
              id="xpack.security.management.roles.showReservedRolesLabel"
              defaultMessage="Show reserved roles"
            />
          }
          checked={this.state.includeReservedRoles}
          onChange={this.onIncludeReservedRolesChange}
        />
      );
    }
  }
  private onCancelDelete = () => {
    this.setState({ showDeleteConfirmation: false });
  };
}
