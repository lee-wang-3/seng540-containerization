import { Construct } from 'constructs';
import autoscaling = require('aws-cdk-lib/aws-autoscaling');
import cdk = require('aws-cdk-lib');
import ecs = require('aws-cdk-lib/aws-ecs');
import ec2 = require('aws-cdk-lib/aws-ec2');
import elbv2 = require('aws-cdk-lib/aws-elasticloadbalancingv2');
import iam = require('aws-cdk-lib/aws-iam');
import logs = require("aws-cdk-lib/aws-logs");
import { readFileSync } from 'fs';


export class Seng540ContainerizationStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

// Create Cluster
  const vpc = new ec2.Vpc(this, 'Vpc', { maxAzs: 4 });

  const cluster = new ecs.Cluster(this, 'EcsCluster', { 
    vpc: vpc,
    containerInsights: true,
   });

  const asg = cluster.addCapacity('DefaultAutoScalingGroup', {
    instanceType: ec2.InstanceType.of(ec2.InstanceClass.M3, ec2.InstanceSize.LARGE),
  });
  asg.addUserData(readFileSync('./bin/user-data', 'utf8'));
  asg.role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'));
  asg.role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonS3FullAccess'));

  // Create Task Role
  const taskRole = new iam.Role(this, "TaskRole", {
    assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com")
  })

  taskRole.addToPolicy(
    new iam.PolicyStatement({
      resources: ["*"],
      actions: ["*"]
    })
  )

  // Create Execution Role
  const executionRole = new iam.Role(this, "ExecutionRole", {
    assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com")
  })

  executionRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEC2ContainerRegistryPowerUser'));

  // Create Task Definition
  const taskDefinition = new ecs.Ec2TaskDefinition(this, 'TaskDefinition', {
    taskRole: taskRole,
    executionRole: executionRole,

  });
  taskDefinition.obtainExecutionRole()

  // Create Container
  const nextjs_container = taskDefinition.addContainer('NextJS', {
    image: ecs.ContainerImage.fromRegistry("471717104567.dkr.ecr.us-east-1.amazonaws.com/seng540-containerization-nextjs:latest"),
    logging: ecs.LogDriver.awsLogs({
      streamPrefix: "app",
      logRetention: logs.RetentionDays.ONE_WEEK,
    }),
    memoryReservationMiB: 256,
    essential: false,
  });
  nextjs_container.addPortMappings({
    containerPort: 3000,
    hostPort: 3000,
    protocol: ecs.Protocol.TCP
  });
  nextjs_container.addPortMappings({
    containerPort: 9229,
    hostPort: 9229,
    protocol: ecs.Protocol.TCP
  });

  const storybook_container = taskDefinition.addContainer('Storybook', {
    image: ecs.ContainerImage.fromRegistry("471717104567.dkr.ecr.us-east-1.amazonaws.com/seng540-containerization-storybook:latest"),
    logging: ecs.LogDriver.awsLogs({
      streamPrefix: "app",
      logRetention: logs.RetentionDays.ONE_WEEK
    }),
    memoryReservationMiB: 512,
    essential: true,
  });
  storybook_container.addPortMappings({
    containerPort: 6006,
    hostPort: 6006,
    protocol: ecs.Protocol.TCP
  });

  // Create Service
  const service = new ecs.Ec2Service(this, "Service", {
    cluster: cluster,
    taskDefinition: taskDefinition,
    desiredCount: 1,
    minHealthyPercent: 0,
  });

  // Create ALB
  const lb = new elbv2.ApplicationLoadBalancer(this, 'ALB', {
    vpc: vpc,
    internetFacing: true,
  });
  lb.connections.allowToAnyIpv4(ec2.Port.allTcp(), "All Out")
  lb.connections.allowFromAnyIpv4(ec2.Port.tcp(80), "In Allowed For Port 80")
  const listener = lb.addListener('PublicListener', { port: 80, protocol: elbv2.ApplicationProtocol.HTTP, open: true });

  // Attach ALB to ECS Service
  listener.addTargets('ECS', {
    port: 6006,
    protocol: elbv2.ApplicationProtocol.HTTP,
    targets: [service.loadBalancerTarget({
      containerName: 'Storybook',
      containerPort: 6006
    })],
    // include health check (default is none)
    healthCheck: {
      protocol: elbv2.Protocol.HTTP,
      interval: cdk.Duration.seconds(300),
      timeout: cdk.Duration.seconds(5),
    }
  });

  new cdk.CfnOutput(this, 'LoadBalancerDNS', { value: lb.loadBalancerDnsName, });
  }
}